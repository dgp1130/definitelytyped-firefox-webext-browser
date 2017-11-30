/*
Requires firefox source code to be downloaded.
Use as:
node index.js -f <FIREFOX VERSION> -s <SCHEMAS1> -s <SCHEMAS2> -o <OUTPUT_FILE>
Where SCHEMAS are toolkit/components/extensions/schemas and
browser/components/extensions/schemas inside the firefox source directory.
For example:
node index.js -f 58.0 -s firefox-58.0b6/toolkit/components/extensions/schemas -s firefox-58.0b6/browser/components/extensions/schemas -o index.d.ts
*/

"use strict";

const fs = require("fs");
const path = require("path");
const stripJsonComments = require("strip-json-comments");
const _ = require("lodash");

const argv = require("minimist")(process.argv.slice(2), {
    string: ['f']
});

const RESERVED = ["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else",
    "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null",
    "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with"];

const NAMESPACE_ALIASES = {contextMenusInternal: 'menusInternal'};
const EXCLUDED_NAMESPACES = ['test'];
const SIMPLE_TYPES = ['string', 'integer', 'number', 'Date', 'boolean', 'any'];

const HEADER = `// Type definitions for WebExtension Development in FireFox ${argv['f']}
// Project: https://developer.mozilla.org/en-US/Add-ons/WebExtensions
// Definitions by: Jacob Bom <https://github.com/bomjacob>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
// TypeScript Version: 2.4
// Generated using script at github.com/bomjacob/definitelytyped-firefox-webext-browser

interface EventListener<T extends (...args: any[]) => any> {
    addListener: (callback: T) => void;
    removeListener: (listener: T) => void;
    hasListener: (listener: T) => boolean;
}

`;

class Converter {
    constructor(folders) {
        this.out = HEADER;

        this.schemaData = [];
        this.collectSchemas(folders);

        this.namespaces = {};
        for (let data of this.schemaData) {
            for (let namespace of data[1]) {
                if (EXCLUDED_NAMESPACES.includes(namespace.namespace)) continue;
                if (!this.namespaces.hasOwnProperty(namespace.namespace)) {
                    this.namespaces[namespace.namespace] = {
                        namespace: namespace.namespace,
                        types: [],
                        properties: {},
                        functions: [],
                        events: []
                    };
                }
                if (namespace.types) this.namespaces[namespace.namespace].types = this.namespaces[namespace.namespace].types.concat(namespace.types);
                if (namespace.properties) this.namespaces[namespace.namespace].properties = Object.assign(this.namespaces[namespace.namespace].properties, namespace.properties);
                if (namespace.functions) this.namespaces[namespace.namespace].functions = this.namespaces[namespace.namespace].functions.concat(namespace.functions);
                if (namespace.events) this.namespaces[namespace.namespace].events = this.namespaces[namespace.namespace].events.concat(namespace.events);
            }
        }
    }

    convert() {
        for (let namespace of Object.keys(this.namespaces)) {
            this.namespace = namespace;
            this.convertNamespace();
        }
    }

    collectSchemas(folders) {
        for (let folder of folders) {
            const files = fs.readdirSync(folder);
            for (let file of files) {
                if (path.extname(file) === '.json') {
                    this.schemaData.push([file, JSON.parse(stripJsonComments(String(fs.readFileSync(path.join(folder, file)))))]);
                }
            }
        }
    }

    // noinspection JSMethodCanBeStatic
    convertPrimitive(type) {
        if (type === 'integer') {
            return 'number'
        }
        return type;
    }

    convertClass(type) {
        let out = `{\n`;
        let convertedProperties = this.convertObjectProperties(type);
        if (type.functions) for (let func of type.functions) {
            convertedProperties.push(this.convertFunction(func, true, true, true));
        }
        if (type.events) for (let event of type.events) {
            convertedProperties.push(this.convertEvent(event, true));
        }
        out += `${convertedProperties.join(';\n') + ';'}`;
        out += `\n}`;

        return out;
    }

    convertObjectProperties(type) {
        let convertedProperties = [];
        if (type.properties) {
            for (let name of Object.keys(type.properties)) {
                let propertyType = type.properties[name];
                propertyType.id = type.id + (name === 'properties' ? '' : ('_' + name));
                convertedProperties.push(`${name}${type.properties[name].optional ? '?' : ''}: ${this.convertType(propertyType)}`);
            }
        } else if (type.patternProperties) {
            for (let name of Object.keys(type.patternProperties)) {
                let keyType = 'string';
                if (name.includes('\\d') && !name.includes('a-z')) keyType = 'number';
                convertedProperties.push(`[key: ${keyType}]: ${this.convertType(type.patternProperties[name])}`);
            }
        }
        return convertedProperties;
    }

    convertRef(ref) {
        let out = '';
        let namespace = ref.split('.')[0];
        if (NAMESPACE_ALIASES.hasOwnProperty(namespace)) {
            namespace = NAMESPACE_ALIASES[namespace];
            ref = `${namespace}.${ref.split('.')[1]}`
        }
        if (namespace === this.namespace) {
            ref = ref.split('.')[1];
        }
        if (Object.keys(this.namespaces).includes(namespace)) {
            //out += 'browser.';
        } else if (!this.namespaces[this.namespace].types.find(x => x.id === ref)) {
            console.log(`Warning: Cannot find reference "${ref}", assuming the browser knows better.`);
            this.additionalTypes.push(`type ${ref} = any;`);
        }
        out += ref;
        return out;
    }

    // noinspection JSMethodCanBeStatic
    convertEnumName(name) {
        return name.split('_').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join('');
    }

    convertType(type, root = false) {
        let out = '';
        if (type.choices) {
            let choices = [];
            let enums = [];
            for (let choice of type.choices) {
                if (choice.enum) {
                    enums = enums.concat(choice.enum);
                } else {
                    choices.push(choice)
                }
            }
            if (enums.length > 0) choices.push({
                id: type.id,
                enum: enums
            });
            let z = choices.map(x => {
                x.id = type.id;
                let y = this.convertType(x);
                if (y === 'any') y = 'object';
                if (y === '() => void') y = 'Function';
                if (y === type.id) y = '__ABORT__';
                return y;
            }).join(' | ');
            if (z.includes('__ABORT__')) return; // TODO: FIX THIS SHIT
            out += z;
        } else if (type.enum) {
            if (type.name && !type.id) type.id = type.name;
            if (root) {
                out += `{\n${type.enum.map(x => `${(x.name ? x.name : x).replace(/\W/g, '')} = "${x.name ? x.name : x}"`).join(',\n')}\n}`
            } else {
                this.additionalTypes.push(`enum _${this.convertEnumName(type.id)} ${this.convertType(type, true)}`);
                out += '_' + this.convertEnumName(type.id);
            }
        } else if (type.type) {
            if (type.type === 'object') {
                if (type.functions || type.events) {
                    out += this.convertClass(type);
                } else if (type.properties || type.patternProperties) {
                    let properties = this.convertObjectProperties(type);
                    if (properties.length > 0) {
                        out += `{\n${properties.join(';\n')};\n}`;
                    } else {
                        out += 'object';
                    }
                } else if (type.isInstanceOf) {
                    if (type.additionalProperties && type.additionalProperties.type === 'any') {
                        out += `object/*${type.isInstanceOf}*/`;
                    } else {
                        out += this.convertRef(type.isInstanceOf);
                    }
                } else if (type.additionalProperties) {
                    out += this.convertType(type.additionalProperties);
                } else {
                    out += 'object';
                }
            } else if (type.type === 'array') {
                if (type.minItems && type.maxItems && type.minItems === type.maxItems) {
                    out += `[${new Array(type.minItems).fill(this.convertPrimitive(type.items.type)).join(', ')}]`
                } else if (type.items) {
                    type.items.id = type.id;
                    let arrayType = this.convertType(type.items);
                    if (arrayType.includes('\n') || arrayType.includes(';') || arrayType.includes(',')) { // Is it a simple type? TODO: Do this better
                        out += `Array<${arrayType}>`;
                    } else {
                        out += `${arrayType}[]`;
                    }
                }
            } else if (type.type === 'function') {
                if (type.name === 'callback') return;
                out += this.convertFunction(type, true, false);
            } else if (SIMPLE_TYPES.includes(type.type)) {
                out += this.convertPrimitive(type.type);
            }
        } else if (type['$ref']) {
            out += this.convertRef(type['$ref']);
        } else if (type.value) {
            out += typeof type.value;
        }
        if (out === '') {
            throw new Error(`Cannot handle type ${JSON.stringify(type)}`);
        }
        return out;
    }

    collapseExtendedTypes(types) {
        let collapsedTypes = {};
        for (let type of types) {
            let name = type['$extend'] || type.id;
            if (collapsedTypes.hasOwnProperty(name)) {
                _.mergeWith(collapsedTypes[name], type, (objValue, srcValue) => {
                    if (_.isArray(objValue)) {
                        return objValue.concat(srcValue);
                    }
                });
            } else {
                delete type['$extend'];
                collapsedTypes[name] = type;
            }
        }
        return Object.values(collapsedTypes);
    }

    convertTypes(types) {
        if (types === undefined) return [];
        types = this.collapseExtendedTypes(types);
        let convertedTypes = [];
        for (let type of types) {
            if (type === undefined) console.log(type);
            let convertedType = this.convertType(type, true);
            if (convertedType === undefined) continue;
            if (convertedType === type.id) convertedType = 'any';
            if (type.functions || type.events) {
                convertedTypes.push(`class ${type.id} ${convertedType}`);
            } else if (type.enum) {
                convertedTypes.push(`enum ${this.convertEnumName(type.id)} ${convertedType}`);
            } else if (type.type === 'object' && !type.isInstanceOf) {
                convertedTypes.push(`interface ${type.id} ${convertedType}`);
            } else {
                convertedTypes.push(`type ${type.id} = ${convertedType};`);
            }
        }
        return convertedTypes
    }

    convertProperties(properties) {
        if (properties === undefined) return [];
        let convertedProperties = [];
        for (let prop of Object.keys(properties)) {
            convertedProperties.push(`const ${prop}: ${this.convertType(properties[prop])}${properties[prop].optional ? ' | undefined' : ''};`);
        }
        return convertedProperties;
    }

    convertParameters(parameters, includeName = true, name = undefined) {
        if (parameters === undefined) return [];
        let convertedParameters = [];
        for (let parameter of Object.keys(parameters)) {
            if (parameters[parameter].type && parameters[parameter].name && parameters[parameter].type === 'function' && parameters[parameter].name === 'callback') continue;
            let out = '';
            if (includeName) out += `${parameters[parameter].name ? parameters[parameter].name : parameter}${parameters[parameter].optional ? '?' : ''}: `;
            parameters[parameter].id = name;
            out += this.convertType(parameters[parameter]);
            convertedParameters.push(out);
        }
        return convertedParameters;
    }

    convertSingleFunction(name, parameters, returnType, arrow, classy) {
        if (arrow) {
            return `${classy ? '' : ''}${classy ? `${name}` : ''}(${parameters.join(', ')})${classy ? ':' : ' =>'} ${returnType}`;
        } else {
            if (RESERVED.includes(name)) {
                //return `const ${name} = function (${parameters.join(', ')}): ${returnType};`;
                this.additionalTypes.push(`export {_${name} as ${name}};`);
                name = '_' + name;
            }
            return `function ${name}(${parameters.join(', ')}): ${returnType};`;
        }
    }

    convertFunction(func, arrow = false, classy = false) {
        let out = '';
        let returnType = 'void';
        if (func.returns) {
            returnType = this.convertType(func.returns);
        } else if (func.async === 'callback') {
            let parameters = this.convertParameters(func.parameters.find(x => x.type === 'function' && x.name === 'callback').parameters, false, func.name);
            if (parameters.length > 1) {
                console.log(`Warning: Promises cannot return more than one value: ${func.name}.`);
                parameters = ['object']
            }
            returnType = `Promise<${parameters.join(', ') || 'void'}>`
        }
        let parameters = this.convertParameters(func.parameters, true, func.name);
        for (let i = 0; i < parameters.length; i++) {
            if (parameters[i].includes('?') && parameters.length > i + 1) {
                out += this.convertSingleFunction(func.name, parameters.slice(i + 1), returnType, arrow, classy) + (classy ? ';\n' : '\n');
            } else {
                break;
            }
        }
        parameters = parameters.map((x, i) => {
            if (parameters.length > 0 && i < parameters.length - 1) {
                return x.replace('?', '');
            }
            return x;
        });

        out += this.convertSingleFunction(func.name, parameters, returnType, arrow, classy);

        return out;
    }

    convertFunctions(functions) {
        if (functions === undefined) return [];
        let convertedFunctions = [];
        for (let func of functions) {
            convertedFunctions.push(this.convertFunction(func, false, false))
        }
        return convertedFunctions;
    }

    // noinspection JSMethodCanBeStatic
    convertSingleEvent(parameters, returnType) {
        return `EventListener<(${parameters.join(', ')}) => ${returnType}>`;
    }

    convertEvent(event, classy = false) {
        let out = '';
        let returnType = 'void';
        if (event.returns) {
            returnType = this.convertType(event.returns);
        }

        let parameters = this.convertParameters(event.parameters, true);
        for (let i = 0; i < parameters.length; i++) {
            if (parameters[i].includes('?') && parameters.length > i + 1) {
                out += '\n| ' + this.convertSingleEvent(parameters.slice(i + 1), returnType, classy);
            } else {
                break;
            }
        }
        parameters = parameters.map((x, i) => {
            if (parameters.length > 0 && i < parameters.length - 1) {
                return x.replace('?', '');
            }
            return x;
        });

        out = `${!classy ? 'const ' : ''}${event.name}: ${this.convertSingleEvent(parameters, returnType, classy)}${out}${!classy ? ';' : ''}`;

        return out;
    }

    convertEvents(events) {
        if (events === undefined) return [];
        let convertedEvents = [];
        for (let event of events) {
            convertedEvents.push(this.convertEvent(event, false))
        }
        return convertedEvents;
    }

    convertNamespace() {
        let data = this.namespaces[this.namespace];
        let out = '';

        this.additionalTypes = [];
        this.types = this.convertTypes(data.types);
        this.properties = this.convertProperties(data.properties);
        this.functions = this.convertFunctions(data.functions);
        this.events = this.convertEvents(data.events);

        this.additionalTypes = _.uniqWith(this.additionalTypes, _.isEqual);

        out += `declare namespace browser.${data.namespace} {\n`;
        if (this.types.length > 0) out += `/* ${data.namespace} types */\n${this.types.join('\n\n')}\n\n`;
        if (this.additionalTypes.length > 0) out += `${this.additionalTypes.join('\n\n')}\n\n`;
        if (this.properties.length > 0) out += `/* ${data.namespace} properties */\n${this.properties.join('\n\n')}\n\n`;
        if (this.functions.length > 0) out += `/* ${data.namespace} functions */\n${this.functions.join('\n\n')}\n\n`;
        if (this.events.length > 0) out += `/* ${data.namespace} events */\n${this.events.join('\n\n')}\n\n`;
        out = out.slice(0, out.length - 1) + '}\n\n';

        this.out += out;
    }

    write(filename) {
        fs.truncate(filename, 0, function () {
            fs.writeFileSync(filename, this.out.slice(0, this.out.length - 1));
        }.bind(this));
    }
}


let converter = new Converter(argv['s']);
converter.convert();
converter.write(argv['o']);

