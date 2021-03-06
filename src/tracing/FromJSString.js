import Origin from "../origin"
import ValueMap from "../value-map"
import unstringTracifyArguments from "./unstringTracifyArguments"
import stringTraceUseValue from "./stringTraceUseValue"
import untrackedArgument from "./untrackedArgument"
import config from "../config"

function FromJSString(options){
    this.origin = options.origin
    this.value = options.value
    if (typeof this.value.toString() !== "string") {
        this.value = this.value.toString()
    }
    this.isStringTraceString = true
}

function isArray(val){
    return val !== null && val.length !== undefined && val.map !== undefined;
}

function capitalizeFirstCharacter(str){
    return str.slice(0, 1).toUpperCase() + str.slice(1)
}

// getOwnPropertyNames instead of for loop b/c props aren't enumerable
Object.getOwnPropertyNames(String.prototype).forEach(function(propertyName){
    if (propertyName === "toString") { return }
    // can't use .apply on valueOf function (" String.prototype.valueOf is not generic")
    if (propertyName === "valueOf") { return }
    if (typeof String.prototype[propertyName] === "function") {
        FromJSString.prototype[propertyName] = function(){
            var oldValue = this;
            var args = unstringTracifyArguments(arguments)
            var newVal;

            var argumentOrigins = Array.prototype.slice.call(arguments).map(function(arg){
                if (arg instanceof FromJSString) {
                    return arg.origin;
                }
                return untrackedArgument(arg)
            })
            var inputValues = [oldValue.origin].concat(argumentOrigins)

            var valueItems = null;
            if (propertyName === "replace") {
                var oldString = oldValue.toString()

                var valueMap = new ValueMap();
                var inputMappedSoFar = ""

                var newVal = oldString.replace(args[0], function(){
                    var argumentsArray = Array.prototype.slice.apply(arguments, [])
                    var match = argumentsArray[0];
                    var submatches = argumentsArray.slice(1, argumentsArray.length - 2)
                    var offset = argumentsArray[argumentsArray.length - 2]
                    var string = argumentsArray[argumentsArray.length - 1]

                    submatches = submatches.map(function(submatch){
                        if (typeof submatch !== "string"){
                            return submatch
                        }

                        return makeTraceObject({
                            value: submatch,
                            origin: new Origin({
                                value: submatch,
                                action: "Replace Call Submatch",
                                inputValues: [oldValue],
                                inputValuesCharacterIndex: [offset + match.indexOf(submatch)]
                            })
                        })
                    })

                    var newArgsArray = [
                        match,
                        ...submatches,
                        offset,
                        string
                    ];

                    var inputBeforeToKeep = oldString.substring(inputMappedSoFar.length, offset)
                    valueMap.appendString(inputBeforeToKeep , oldValue.origin, inputMappedSoFar.length)
                    inputMappedSoFar += inputBeforeToKeep

                    var replaceWith = null;
                    // confusing... args[1] is basically inputValues[2].value
                    if (typeof args[1] === "string" || typeof args[1] === "number") {
                        var value = args[1].toString();
                        value = value.replace(/\$([0-9]{1,2}|[$`&'])/g, function(dollarMatch, dollarSubmatch){
                            if (!isNaN(parseFloat(dollarSubmatch))){
                                return submatches[parseFloat(dollarSubmatch) - 1] // $n is one-based, array is zero-based
                            } else if (dollarSubmatch === "&"){
                                return match
                            } else {
                                throw "not handled!!"
                            }
                        })

                        replaceWith = {
                            value: value,
                            origin: inputValues[2]
                        }
                    } else if (typeof args[1] === "function"){
                        replaceWith = args[1].apply(this, newArgsArray)
                        if (!replaceWith.origin) {
                            replaceWith = makeTraceObject({
                                value: replaceWith,
                                origin: {
                                    value: replaceWith,
                                    action: "Untracked replace match result",
                                    inputValues: []
                                }
                            })
                        } else {
                            replaceWith = {
                                value: replaceWith.value,
                                origin: replaceWith.origin
                            }
                        }
                    } else {
                        throw "not handled"
                    }
                    valueMap.appendString(replaceWith.value, replaceWith.origin, 0)


                    inputMappedSoFar += match

                    return replaceWith.value
                })

                valueMap.appendString(oldString.substring(inputMappedSoFar.length), oldValue.origin, inputMappedSoFar.length)

                valueItems = valueMap.serialize(inputValues)

            } else if (propertyName === "slice"){
                var oldString = oldValue.toString()

                var valueMap = new ValueMap();
                var from = args[0]
                var to = args[1]

                if (to < 0) {
                    to = oldString.length + to;
                }

                newVal = oldString.slice(from, to)

                valueMap.appendString(newVal, oldValue.origin, from) // oldvalue.origin is inputValues[0]

                valueItems = valueMap.serialize(inputValues)
            } else if (propertyName === "substr"){
                var oldString = oldValue.toString();
                var start = args[0]
                if (start < 0){
                    start = oldString.length + start
                }
                var length = args[1]
                if (length === undefined){
                    length = oldString.length - start;
                }

                newVal = oldString.substr(start, length)
                var valueMap = new ValueMap()
                valueMap.appendString(newVal, oldValue.origin, start)
                valueItems = valueMap.serialize(inputValues)

            } else {
                if (config.logUntrackedStrings) {
                    console.trace("string not tracked after ",propertyName ,"call")
                }
                newVal = String.prototype[propertyName].apply(this.toString(), args);
            }

            var actionName = capitalizeFirstCharacter(propertyName) + " Call";

            if (typeof newVal === "string") {
                return makeTraceObject(
                    {
                        value: newVal,
                        origin: new Origin({
                            value: newVal,
                            valueItems: valueItems,
                            inputValues: inputValues,
                            action: actionName
                        })
                    }
                )
            } else if (isArray(newVal)) {
                return newVal.map(function(val){
                    if (typeof val === "string"){
                        return makeTraceObject(
                            {
                                value: val,
                                origin: new Origin({
                                    value: val,
                                    inputValues: inputValues,
                                    action: actionName,
                                })
                            }
                        )
                    } else {
                        return val
                    }
                })
            } else {
                return newVal
            }
        }
    }
})
FromJSString.prototype.valueOf = function(){
    return this.value;
}
FromJSString.prototype.toString = function(){
    return this.value
}
FromJSString.prototype.toJSON = function(){
    return this.value
}
Object.defineProperty(FromJSString.prototype, "length", {
    get: function(){
        return this.value.length;
    }
})

export function makeTraceObject(options){
    if (options === undefined || options.value === undefined || options.origin === undefined) {
        throw "invalid options"
    }
    var stringTraceObject = new FromJSString({
        value: stringTraceUseValue(options.value),
        origin: options.origin
    })

    return new Proxy(stringTraceObject, {
        get: function(target, name){
            if (typeof name !== "symbol" && !isNaN(parseFloat(name))) {
                return target.value[name]
            }

            return stringTraceObject[name]
        }
    });
}
