import addElOrigin from "./addElOrigin"
import $ from "jquery"
import tagTypeHasClosingTag from "./tagTypeHasClosingTag"
import stringTraceUseValue from "./stringTraceUseValue"
import {goUpForDebugging} from "../whereDoesCharComeFrom"
import config from "../config"

// tries to describe the relationship between an assigned innerHTML value
// and the value you get back when reading el.innerHTML.
// e.g. you could assign "<input type='checkbox' checked>" and get back
// "<input type='checkbox' checked=''>"
// essentially this function serializes the elements content and compares it to the
// assigned value
export default function mapInnerHTMLAssignment(el, assignedInnerHTML, actionName, initialExtraCharsValue, contentEndIndex){
    var serializedHtml = nativeInnerHTMLDescriptor.get.call(el)
    var forDebuggingProcessedHtml = ""
    var charOffsetInSerializedHtml = 0;
    var charsAddedInSerializedHtml = 0;
    if (initialExtraCharsValue !== undefined){
        charsAddedInSerializedHtml = initialExtraCharsValue
    }
    var assignedString = assignedInnerHTML.value ? assignedInnerHTML.value : assignedInnerHTML; // somehow  getting weird non-string, non fromjs-string values
    if (contentEndIndex === 0) {
        contentEndIndex = assignedString.length
    }

    var error = Error() // used to get stack trace, rather than creating a new one every time
    processNewInnerHtml(el)

    function getCharOffsetInAssignedHTML(){
        return charOffsetInSerializedHtml - charsAddedInSerializedHtml
    }

    function validateMapping(mostRecentOrigin){
        if (!config.validateHtmlMapping) {
            return
        }
        var step = {
            originObject: mostRecentOrigin,
            characterIndex: charOffsetInSerializedHtml - 1
        }

        goUpForDebugging(step, function(newStep){
            if (assignedString[newStep.characterIndex] !== serializedHtml[charOffsetInSerializedHtml - 1]){
                // This doesn't necessarily mean anything is going wrong.
                // For example, you'll get this warning every time you assign an
                // attribute like this: <a checked>
                // because it'll be changed into: <a checked="">
                // and then we compare the last char of the attribute,
                // which will be 'd' in the assigned string and '"' in
                // the serialized string
                // however, I don't think there's ever a reason for this to be
                // called repeatedly. That would indicate a offset problem that
                // gets carried through the rest of the assigned string
                console.warn("strings don't match", assignedString[newStep.characterIndex], serializedHtml[charOffsetInSerializedHtml - 1])
            }
        })
    }


    function processNewInnerHtml(el){
        var children = Array.prototype.slice.apply(el.childNodes, [])
        addElOrigin(el, "replaceContents", {
            action: actionName,
            children: children
        });

        [].slice.call(el.childNodes).forEach(function(child){
            var isTextNode = child.nodeType === 3
            var isCommentNode = child.nodeType === 8
            var isElementNode = child.nodeType === 1
            var isIframe = child
            var extraCharsAddedHere = 0;
            if (isTextNode) {

                var text = child.textContent
                if (child.parentNode.tagName !== "SCRIPT") {
                    var div = originalCreateElement.apply(document, ["div"])
                    nativeInnerHTMLDescriptor.set.call(div, text)
                    text = nativeInnerHTMLDescriptor.get.call(div)
                }
                var offsets = []

                for (var i=0; i<text.length; i++) {
                    var char = text[i];

                    var htmlEntityMatchAfterAssignment = text.substr(i,30).match(/^\&[a-z]+\;/)

                    var posInAssignedString = charOffsetInSerializedHtml + i - charsAddedInSerializedHtml - extraCharsAddedHere;
                    if (contentEndIndex >= posInAssignedString) {
                        // http://stackoverflow.com/questions/38892536/why-do-browsers-append-extra-line-breaks-at-the-end-of-the-body-tag
                        break; // just don't bother for now
                    }
                    var textIncludingAndFollowingChar = assignedString.substr(posInAssignedString, 30); // assuming that no html entity is longer than 30 chars
                    var htmlEntityMatch = textIncludingAndFollowingChar.match(/^\&[a-z]+\;/)

                    offsets.push(-extraCharsAddedHere)

                    if (htmlEntityMatchAfterAssignment !== null && htmlEntityMatch === null) {
                        // assigned a character, but now it shows up as an entity (e.g. & ==> &amp;)
                        var entity = htmlEntityMatchAfterAssignment[0]
                        for (var n=0; n<entity.length-1;n++){
                            i++
                            extraCharsAddedHere++;
                            offsets.push(-extraCharsAddedHere)
                        }
                    }

                    if (htmlEntityMatchAfterAssignment === null && htmlEntityMatch !== null) {
                        // assigned an html entity but now getting character back (e.g. &raquo; => »)
                        var entity = htmlEntityMatch[0]
                        extraCharsAddedHere -= entity.length - 1;
                    }
                }

                if (offsets.length === 0) {
                    offsets = undefined
                }

                addElOrigin(child, "textValue", {
                    action: actionName,
                    inputValues: [assignedInnerHTML],
                    value: serializedHtml,
                    inputValuesCharacterIndex: [charOffsetInSerializedHtml],
                    extraCharsAdded: charsAddedInSerializedHtml,
                    offsetAtCharIndex: offsets,
                    error: error
                })

                charsAddedInSerializedHtml += extraCharsAddedHere
                charOffsetInSerializedHtml += text.length
                forDebuggingProcessedHtml += text

                validateMapping(child.__elOrigin.textValue)
            } else if (isCommentNode) {
                var comment = "<!--" + child.textContent + "-->"
                addElOrigin(child, "textValue", {
                    value: comment,
                    inputValues: [],
                    action: "HTML Comment",
                    error: error
                })
                charOffsetInSerializedHtml += comment.length;
                forDebuggingProcessedHtml += comment;
            } else if (isElementNode) {

                addElOrigin(child, "openingTagStart", {
                    action: actionName,
                    inputValues: [assignedInnerHTML],
                    inputValuesCharacterIndex: [charOffsetInSerializedHtml],
                    value: serializedHtml,
                    extraCharsAdded: charsAddedInSerializedHtml,
                    error: error
                })
                var openingTagStart = "<" + child.tagName
                charOffsetInSerializedHtml += openingTagStart.length
                forDebuggingProcessedHtml += openingTagStart

                validateMapping(child.__elOrigin.openingTagStart)

                for (var i = 0;i<child.attributes.length;i++) {
                    var attr = child.attributes[i]

                    var charOffsetInSerializedHtmlBefore = charOffsetInSerializedHtml

                    var whiteSpaceBeforeAttributeInSerializedHtml = " "; // always the same
                    var assignedValueFromAttrStartOnwards = assignedString.substr(getCharOffsetInAssignedHTML(), 100)
                    var whiteSpaceMatches = assignedValueFromAttrStartOnwards.match(/^[\W]+/)

                    var whiteSpaceBeforeAttributeInAssignedHtml;
                    if (whiteSpaceMatches !== null) {
                        whiteSpaceBeforeAttributeInAssignedHtml = whiteSpaceMatches[0]
                    } else {
                        // something broke, but better to show a broken result than nothing at all
                        if (config.validateHtmlMapping) {
                            console.warn("no whitespace found at start of", assignedValueFromAttrStartOnwards)
                        }
                        whiteSpaceBeforeAttributeInAssignedHtml = "";
                    }

                    var attrStr = attr.name
                    attrStr += "='" + attr.textContent +  "'"

                    var assignedAttrStr = assignedString.substr(getCharOffsetInAssignedHTML() + whiteSpaceBeforeAttributeInAssignedHtml.length, attrStr.length)

                    var offsetAtCharIndex = []
                    var extraCharsAddedHere = 0;

                    var extraWhitespaceInAssignedHtml = whiteSpaceBeforeAttributeInAssignedHtml.length - whiteSpaceBeforeAttributeInSerializedHtml.length
                    extraCharsAddedHere -= extraWhitespaceInAssignedHtml

                    offsetAtCharIndex.push(-extraCharsAddedHere); // char index for " " before attr

                    if (attr.textContent === "" && !attrStrContainsEmptyValue(assignedAttrStr)){
                        for (var charIndex in attrStr){
                            if (charIndex >= attrStr.length - '=""'.length){
                                extraCharsAddedHere++;
                                offsetAtCharIndex.push(-extraCharsAddedHere)
                            } else {
                                offsetAtCharIndex.push(-extraCharsAddedHere)
                            }
                        }
                    } else {
                        for (var charIndex in attrStr){
                            offsetAtCharIndex.push(-extraCharsAddedHere)
                        }
                    }

                    addElOrigin(child, "attribute_" + attr.name, {
                        action: actionName,
                        inputValues: [assignedInnerHTML],
                        value: whiteSpaceBeforeAttributeInSerializedHtml + attrStr,
                        inputValuesCharacterIndex: [charOffsetInSerializedHtmlBefore],
                        extraCharsAdded: charsAddedInSerializedHtml,
                        offsetAtCharIndex: offsetAtCharIndex,
                        error: error
                    })

                    charsAddedInSerializedHtml += extraCharsAddedHere

                     charOffsetInSerializedHtml += whiteSpaceBeforeAttributeInSerializedHtml.length + attrStr.length
                    forDebuggingProcessedHtml += whiteSpaceBeforeAttributeInSerializedHtml + attrStr

                    var attrPropName = "attribute_" + attr.name;
                    validateMapping(child.__elOrigin[attrPropName])
                }

                var openingTagEnd = ">"
                if (assignedString[getCharOffsetInAssignedHTML()] === " ") {
                    // something like <div > (with extra space)
                    // this char will not show up in the re-serialized innerHTML
                    // TODO: make it work if there's more than one space!!!
                    charsAddedInSerializedHtml -= 1;
                }
                if (!tagTypeHasClosingTag(child.tagName)) {
                    if (assignedString[getCharOffsetInAssignedHTML()] === "/") {
                        // something like <div/> (with extra space)
                        // this char will not show up in the re-serialized innerHTML
                        charsAddedInSerializedHtml -= 1;
                    }
                    var explicitClosingTag = "</" + child.tagName.toLowerCase() + ">"
                    var explicitClosingTagAndOpeningTagEnd = ">" + explicitClosingTag
                    if (assignedString.substr(getCharOffsetInAssignedHTML(), explicitClosingTagAndOpeningTagEnd.length).toLowerCase() === explicitClosingTagAndOpeningTagEnd) {
                        // something like <div/> (with extra space)
                        // this char will not show up in the re-serialized innerHTML
                        charsAddedInSerializedHtml -= explicitClosingTag.length;
                    }
                }
                addElOrigin(child, "openingTagEnd", {
                    action: actionName,
                    inputValues: [assignedInnerHTML],
                    inputValuesCharacterIndex: [charOffsetInSerializedHtml],
                    value: serializedHtml,
                    extraCharsAdded: charsAddedInSerializedHtml,
                    error: error
                })
                charOffsetInSerializedHtml += openingTagEnd.length
                forDebuggingProcessedHtml += openingTagEnd

                validateMapping(child.__elOrigin.openingTagEnd)


                if (child.tagName === "IFRAME") {
                    forDebuggingProcessedHtml += child.outerHTML;
                    charOffsetInSerializedHtml += child.outerHTML.length
                } else {
                    processNewInnerHtml(child)
                }

                if (tagTypeHasClosingTag(child.tagName)) {
                    addElOrigin(child, "closingTag", {
                        action: actionName,
                        inputValues: [assignedInnerHTML],
                        inputValuesCharacterIndex: [charOffsetInSerializedHtml],
                        value: serializedHtml,
                        extraCharsAdded: charsAddedInSerializedHtml,
                        error: error
                    })
                    var closingTag = "</" + child.tagName + ">"
                    charOffsetInSerializedHtml += closingTag.length
                    forDebuggingProcessedHtml += closingTag
                }

            } else {
                throw "not handled"
            }
            // console.log("processed", forDebuggingProcessedHtml, assignedInnerHTML.toString().toLowerCase().replace(/\"/g, "'") === forDebuggingProcessedHtml.toLowerCase())

        })
    }
}

var emptyAttrStrRegex = /.*=['"]{2}/
function attrStrContainsEmptyValue(attrStr) {
    return emptyAttrStrRegex.test(attrStr)
}
