#!/usr/bin/env node

"use strict";

var fs = require('fs');
var path = require('path');
var tscore = require('./tscore');

function startsWith(s, prefix) {
    return s.substring(0, prefix.length) === prefix;
}

function isFromOrigin(origin, obj) {
    return obj.meta.origin === origin;
}

// Types
//   NYI:
//     - string-const

function isBuiltin(obj) {
    return ["number", "string", "boolean", "void", "any"].indexOf(obj.type) >= 0;
}

function isType(type, obj) {
    return obj.type === type;
}
var isObject = isType.bind(this, "object");
var isReference = isType.bind(this, "reference");
var isEnum = isType.bind(this, "enum");
var isTypeParam = isType.bind(this, "type-param");

// Kinds
function isKind(kind, obj) {
    return isObject(obj) && obj.meta.kind === kind;
}
var isModule = isKind.bind(this, 'module');
var isInterface = isKind.bind(this, 'interface');
var isClass = isKind.bind(this, 'class');

function isTopLevel(dts, scope) {
    return !!(dts.modules[scope] || dts.env[scope]);
}

// Is this correct?
function isFunction(obj) {
    return isInterface(obj) && obj.calls && obj.calls.length > 0;
}

function isEvent(propName) {
    return startsWith(propName, "on");
}

var eventNameCapitalization = {
    onaccessibilityannotationcomplete: "onAccessibilityAnnotationComplete",
    onafterclose: "onAfterClose",
    onafterhide: "onAfterHide",
    onafteropen: "onAfterOpen",
    onaftershow: "onAfterShow",
    onbeforeclose: "onBeforeClose",
    onbeforehide: "onBeforeHide",
    onbeforeopen: "onBeforeOpen",
    onbeforeshow: "onBeforeShow",
    oncancel: "onCancel",
    onchange: "onChange",
    onchildrenprocessed: "onChildrenProcessed",
    onclick: "onClick",
    onclosed: "onClosed",
    oncontentanimating: "onContentAnimating",
    ondatasourcecountchanged: "onDataSourceCountChanged",
    onfootervisibilitychanged: "onFooterVisibilityChanged",
    ongroupheaderinvoked: "onGroupHeaderInvoked",
    onheaderinvoked: "onHeaderInvoked",
    onheadervisibilitychanged: "onHeaderVisibilityChanged",
    oninvoked: "onInvoked",
    onitemanimationend: "onItemAnimationEnd",
    onitemanimationstart: "onItemAnimationStart",
    onitemdragbetween: "onItemDragBetween",
    onitemdragchanged: "onItemDragChanged",
    onitemdragdrop: "onItemDragDrop",
    onitemdragend: "onItemDragEnd",
    onitemdragenter: "onItemDragEnter",
    onitemdragleave: "onItemDragLeave",
    onitemdragstart: "onItemDragStart",
    oniteminvoked: "onItemInvoked",
    onkeyboardnavigating: "onKeyboardNavigating",
    onloadingstatechanged: "onLoadingStateChanged",
    onopened: "onOpened",
    onpagecompleted: "onPageCompleted",
    onpageselected: "onPageSelected",
    onpagevisibilitychanged: "onPageVisibilityChanged",
    onpreviewchange: "onPreviewChange",
    onquerychanged: "onQueryChanged",
    onquerysubmitted: "onQuerySubmitted",
    onreceivingfocusonkeyboardinput: "onReceivingFocusOnKeyboardInput",
    onresultsuggestionchosen: "onResultSuggestionChosen",
    onresultsuggestionschosen: "onResultSuggestionsChosen",
    onselectionchanged: "onSelectionChanged",
    onselectionchanging: "onSelectionChanging",
    onsplittoggle: "onSplitToggle",
    onsuggestionsrequested: "onSuggestionsRequested",
    onzoomchanged: "onZoomChanged"
};

var namespacesToIgnore = [
    "WinJS.UI.DOMEventMixin",
    "WinJS.UI.HtmlControl",
    "WinJS.UI.Layout",
    "WinJS.UI.MediaElementAdapter",
    "WinJS.UI.MediaPlayer",
    "WinJS.UI.Repeater",
    "WinJS.UI.SettingsFlyout",
    "WinJS.UI.StorageDataSource",
    "WinJS.UI.TabContainer",
    "WinJS.UI.ViewBox",
    "WinJS.UI.VirtualizedDataSource"
];
function keepNamespace(name, obj) {
    return isClass(obj) && startsWith(name, "WinJS.UI.") &&
        namespacesToIgnore.indexOf(name) === -1;
}

var eventTypeInfo = {
    name: "Function",
    type: "reference",
    typeArguments: []
};

function getEnumTypeInfo(enums, name) {
    return {
        type: "enum",
        values: enums[name].map(function (value) {
            var parts = value.split(".");
            return parts[parts.length - 1];
        })
    };
}

// Some WinJS enums are typed as strings in the d.ts. By convention, the values of
// such enums are available off of a static property which has the same name as the
// instance property although the first letter is capitalized. For example, each
// SplitView has a panePlacement property and its values are available under
// WinJS.UI.SplitView.PanePlacement. This function, given the name of an instance
// property, uses this convention to extract the enum values for that property. If
// the property doesn't follow the convention, null is returned.
function getStringBasedEnumTypeInfo(env, namespace, propName) {
    var parts = namespace.split(".");
    if (startsWith(namespace, "WinJS.UI.") && parts.length === 3) {
        var controlName = parts[parts.length - 1];
        var theClass = env["module:WinJS.UI"].object.properties[controlName];
        if (theClass) {
            var name = propName[0].toUpperCase() + propName.substring(1);
            var enumDef = theClass.type.properties[name];
            if (enumDef) {
                return {
                    type: "enum",
                    values: Object.keys(enumDef.type.properties)
                };
            }
        }
    }
    return null;
}

function getControlsAndProperties(env, enums) {
    var missingEvents = {};
    function getProperties(namespace, obj) {
        var props = {};
        Object.keys(obj.properties).forEach(function (propName) {
            var p = obj.properties[propName].type;
            if (isBuiltin(p) || isReference(p) || isEnum(p) || isFunction(p)) {
                if (isEvent(propName)) {
                    var capitalizedEventName = eventNameCapitalization[propName];
                    if (capitalizedEventName) {
                        props[capitalizedEventName] = eventTypeInfo;
                    } else {
                        missingEvents[propName] = true;
                    }
                } else if (isEnum(p)) {
                    props[propName] = getEnumTypeInfo(enums, p.name);
                } else if (p.type === "string") {
                    props[propName] = getStringBasedEnumTypeInfo(env, namespace, propName) || p;
                } else if (!isFunction(p)) {
                    // All functions, other than events, are ignored.
                    props[propName] = p;
                }
            } else {
                debugger;
                throw "getControlsAndProperties getProperties NYI: " + JSON.stringify(p, null, 2);
            }
        });
        return props;
    }

    var out = {};
    for (var namespace in env) {
        var obj = env[namespace].object;
        if (keepNamespace(namespace, obj)) {
            var parts = namespace.split(".");
            var lastPart = parts[parts.length - 1];
            out[lastPart] = getProperties(namespace, obj);
        }
    }

    if (Object.keys(missingEvents).length > 0) {
        console.log("Unknown capitalization for the following events. Please update eventNameCapitalization to include these events:");
        var len = Object.keys(missingEvents).length;
        Object.keys(missingEvents).sort().forEach(function (eventName, i) {
            console.log('  ' + eventName + ': "' + eventName + '"' + (i + 1 === len ? "" : ","));
        });
        throw "Unknown capitalization for some events.";
    }

    return out;
}

function processFile(filePath) {
    var text = fs.readFileSync(filePath, 'utf8').toString();
    var result = tscore([
        {
            file: ">lib.d.ts",
            text: fs.readFileSync(__dirname + '/lib/lib.d.ts', 'utf8')
        },
        { file: filePath, text: text }
    ]);

    return getControlsAndProperties(result.env, result.enums);
}

function indent(n) {
    var s = "";
    while (n-- > 0) {
        s += "    ";
    }
    return s;
}

function sortedPrint(obj, indentCount) {
    if (typeof obj === "boolean" || typeof obj === "number") {
        return "" + obj;
    } else if (typeof obj === "string") {
        return '"' + obj + '"';
    } else if (Array.isArray(obj)) {
        return sortedPrintArray(obj, indentCount);
    } else if (typeof obj === "object") {
        return sortedPrintObject(obj, indentCount);
    } else {
        throw "sortedPrint: unknown type: " + (typeof obj);
    }
}

function sortedPrintArray(array, indentCount) {
    indentCount = (indentCount || 0) + 1;
    var count = array.length;
    if (count > 0) {
        var out = "[";
        array.sort().forEach(function (item, i) {
            out += "\n" + indent(indentCount) + sortedPrint(item, indentCount) + (i + 1 < count ? "," : "");
        });
        out += "\n" + indent(indentCount - 1) + "]";
        return out;
    } else {
        return "[]";
    }
}

function sortedPrintObject(obj, indentCount) {
    indentCount = (indentCount || 0) + 1;
    var keys = Object.keys(obj);
    var keyCount = keys.length;
    if (keyCount > 0) {
        var out = "{";
        keys.sort().forEach(function (key, i) {
            out += "\n" + indent(indentCount) + key + ": " + sortedPrint(obj[key], indentCount) + (i + 1 < keyCount ? "," : "");
        });
        out += "\n" + indent(indentCount - 1) + "}";
        return out;
    } else {
        return "{}";
    }
}

function main() {
    if (process.argv.length < 3) {
        console.log("Please pass a valid path. Usage: node main.js /path/to/winjs.d.ts");
        return;
    }

    var filePath = path.resolve(process.argv[2]);
    var output = processFile(filePath);
    
    var s = "var RawControlApis = " + sortedPrint(output) + ";";
    console.log(s);
}

if (require.main === module) {
    main();
}
