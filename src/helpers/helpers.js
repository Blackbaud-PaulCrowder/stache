/**
* Stache Helpers
* Bobby Earl, 2015-02-12
*
* NOTES
*   - Overriding default markdown / md helpers for one simple reason.
*   - Nesting HTML generated text with four spaces.  Marked thinks this is code.
*   - In order to fix this, I override the rule that supports four spaces as code.
*   - The GFM (```) for code still works.
**/

/*jslint node: true, nomen: true, plusplus: true */
'use strict';

module.exports.register = function (Handlebars, options, params) {

    var bypassContext = params.assemble.options.getBypassContext(),
        stache = params.assemble.options.stache,
        merge = require('merge'),
        cheerio = require('cheerio'),
        fs = require('fs'),
        marked = require('marked'),
        UglifyJS = require('uglify-js'),
        renderer = new marked.Renderer(),
        lexer = new marked.Lexer(),
        counts = {};

    lexer.rules.code = /ANYTHING_BUT_FOUR_SPACES/;

    // https://github.com/chjj/marked/blob/master/lib/marked.js#L890
    renderer.image = function (href, title, text) {
        var out;

        if (href.indexOf('/static/') > -1) {
            href = href.replace('/static/', '/');
        }

        out = '<img src="' + href + '" alt="' + text + '"';
        if (title) {
            out += ' title="' + title + '"';
        }
        out += renderer.options.xhtml ? '/>' : '>';
        return out;
    };

    /**
    * Utility function to get the basename
    **/
    function basename(path, clean) {
        var dot;

        // Clean is optional, but defaults to true
        if (arguments.length !== 2) {
            clean = true;
        }

        if (clean && path) {
            dot = path.lastIndexOf('.');

            // Replace the extension
            path = dot === -1 ? path : path.substr(0, dot);

            // Replace the default page name
            path = path.replace('index', '');

            // Remove our build folder
            path = path.replace(stache.config.build, '');

            // Remove leading & trailing slash
            path = path.replace(/^\/|\/$/g, '');

        // Always return a path
        } else {
            path = '';
        }

        return path;
    }

    /**
    * Determines if two URI's are the same.
    * Supports thinking parent uri's are active.
    * Wrapping the basenames in '/' prevents false matches, ie docs vs docs2 vs 2docs.
    **/
    function isActiveNav(dest, uri, parentCanBeActive) {
        dest = '/' + basename(dest) + '/';
        uri = '/' + basename(uri) + '/';
        return (parentCanBeActive && uri !== '') ? dest.indexOf(uri) > -1 : uri === dest;
    }

    /**
    * Recursively searches the nav array to find the active link
    **/
    function getActiveNav(dest, nav_links, parentCanBeActive) {
        var j = nav_links.length,
            i = 0,
            r = '';

        for (i; i < j; i++) {
            if (isActiveNav(dest, nav_links[i].uri, parentCanBeActive)) {
                r = nav_links[i];
            } else if (nav_links[i].nav_links) {
                r = getActiveNav(dest, nav_links[i].nav_links, parentCanBeActive);
            }
            if (r !== '') {
                break;
            }
        }

        return r;
    }

    /**
    * Light wrapper for our custom markdown processor.
    **/
    function getMarked(md) {
        return marked.parser(lexer.lex(md || ''), {
            headerPrefix: '',
            renderer: renderer
        });
    }

    /**
    * http://stackoverflow.com/questions/10015027/javascript-tofixed-not-rounding
    **/
    function toFixed(number, precision) {
        var multiplier = Math.pow(10, precision + 1),
            wholeNumber = Math.round(number * multiplier).toString(),
            length = wholeNumber.length - 1;

        wholeNumber = wholeNumber.substr(0, length);
        return [
            wholeNumber.substr(0, length - precision),
            wholeNumber.substr(-precision)
        ].join('.');
    }

    /**
    * Fixes Windows Newlines
    **/
    function newline(text) {
        return text ? text.replace(/\r\n/g, '\n') : '';
    }

    /**
    * Function for arranging an array for vertical display.
    **/
    function forVertical(arr, cols) {
        var temp,
            r = [],
            row = 0,
            col = 0,
            len = arr.length,
            rows = Math.ceil(len / cols);

        while (row < rows) {
            temp = row + (col * rows);
            if (temp >= len) {
                row++;
                col = 0;
            } else {
                r.push(arr[temp]);
                col++;
            }
        }

        return r;
    }

    Handlebars.registerHelper({

        /**
        * Get an operation from data.operations.
        * @param {string} [property] - Returns a specific property of the operation.
        * @param {string} [name] - Search the list of operations on any property.
        * @example
        * {{# withOperation name="Address (Create)" }} {{ id }} {{/ withOperation }}
        * {{ getOperation name="Address (Create)" property="description" }}
        **/
        getOperation: function (context) {
            var operations = params.assemble.options.data.operations,
                hasProperty,
                filtered,
                prop;

            if (!operations) {
                return '';
            }

            hasProperty = context.hash.property !== 'undefined';
            
            filtered = operations.filter(function (item) {
                for (prop in context.hash) {
                    if (context.hash.hasOwnProperty(prop) && prop !== 'property') {
                        if (!item.hasOwnProperty(prop) || item[prop].indexOf(context.hash[prop]) === -1) {
                            return false;
                        }
                    }
                }
                return true;
            });

            if (filtered.length === 1) {
                filtered = filtered[0];
            }

            if (hasProperty && typeof filtered[context.hash.property] !== 'undefined') {
                filtered = filtered[context.hash.property];
            }

            return filtered;
        },

        /**
        * Shortcut for this "{{ getOperation name='Address (Create)' property='id' }}"
        * AND, more importantly, it corrects the azure links.
        **/
        getOperationUri: function (context) {
            var operation = Handlebars.helpers.getOperation(context);
            if (operation) {
                return operation.id.replace('/apis/', 'docs/services/');
            }
        },

        /**
        * Presents a context with the results returned from getOperation
        * @param {array} [context.hash] - Optional key/value pairs to pass to @getOperation
        **/
        withOperation: function (context) {
            return context.fn(Handlebars.helpers.getOperation(context));
        },

        /**
        * Compares "uri" in the current context (or the first parameter) to the current URL
        * http://assemble.io/docs/FAQ.html
        **/
        isActiveNav: function (options) {
            var r = isActiveNav(options.hash.dest || this.dest || '', options.hash.uri || this.uri || '', typeof options.hash.parentCanBeActive !== 'undefined' ? options.hash.parentCanBeActive : true);
            return r ? options.fn(this) : options.inverse(this);
        },

        /**
        * Is the current page home
        **/
        isHome: function (options) {
            var b = basename(options.hash.dest || this.page.dest || 'NOT_HOME', true);
            return b === '' ? options.fn(this) : options.inverse(this);
        },

        /**
        * Debugging JSON content
        **/
        json: function (context) {
            return JSON.stringify(context);
        },

        /**
        * Does the current page have headings?
        **/
        hasHeadings: function (options) {
            return Handlebars.helpers.eachHeading(options) !== '' ? options.fn(this) : options.inverse(this);
        },

        /**
        * This innocuous looking helper took quite a long time to figure out.
        * It takes the current pages entire RAW source, crompiles it, and loads it in cheerio (jQuery).
        * Then it parses for the relevant headers and executes the template for each one.
        **/
        eachHeading: function (options) {
            var html = getMarked(Handlebars.compile(options.hash.page || '')(params.assemble.options)),
                r = '';

            cheerio(options.hash.selector || 'h2', html).each(function () {
                var el = cheerio(this);
                r = r + options.fn({
                    name: el.text(),
                    id: el.attr('id'),
                    draft: el.parent().hasClass('draft')
                });
            });

            return r;
        },

        /**
        * Finds the current page in the nav and iterates its child links
        * Supports optional modulus parameters.
        **/
        eachChildLink: function (options) {
            var dest = '',
                nav_links = '',
                active;

            if (typeof options.hash.dest !== 'undefined') {
                dest = options.hash.dest;
            } else if (typeof this.page !== 'undefined' && typeof this.page.dest !== 'undefined') {
                dest = this.page.dest;
            }

            if (typeof options.hash.nav_links !== 'undefined') {
                nav_links = options.hash.nav_links;
            } else if (typeof bypassContext.nav_links !== 'undefined') {
                nav_links = bypassContext.nav_links;
            }

            active = getActiveNav(dest, nav_links, false);
            if (active && active.nav_links) {
                active = active.nav_links;
            }

            return Handlebars.helpers.eachWithMod(active, options);
        },

        eachWithMod: function (context, options) {
            var r = '',
                slim = [],
                counter = 0,
                i = 0,
                m = 0,
                mod = options.hash.mod || 0,
                limit = options.hash.limit || -1,
                layout = options.hash.layout || 'horizontal',
                sortKey = options.hash.sortKey || '',
                sortDesc = typeof options.hash.sortDesc !== 'undefined' ? options.hash.sortDesc : false,
                sortA = 1,
                sortB = -1,
                j,
                show;

            if (context && context.length) {

                // Sort differently if Needed
                if (sortKey !== '') {
                    if (sortDesc) {
                        sortA = -1;
                        sortB = 1;
                    }
                    context = context.sort(function (a, b) {
                        return a[sortKey] > b[sortKey] ? sortA : (a[sortKey] < b[sortKey] ? sortB : 0);
                    });
                }

                j = context.length;
                for (i; i < j; i++) {

                    // Don't go past our limit
                    if (limit !== -1 && counter >= limit) {
                        break;
                    }

                    // Make sure the page doesn't say ignore
                    show = true;
                    if (typeof context[i].showInNav !== 'undefined' && context[i].showInNav === false) {
                        show = false;
                    }

                    if (show) {
                        slim.push(context[i]);
                        counter++;
                    }
                }

                // Organize vertically
                if (layout === 'vertical' && mod > 0) {
                    slim = forVertical(slim, mod);
                }

                // Display the real items
                for (i = 0, j = slim.length; i < j; i++) {
                    m = i % mod;
                    slim[i].first = i === 0;
                    slim[i].last = i === j - 1;
                    slim[i].mod = m;
                    slim[i].cols = mod;
                    slim[i].mod0 = m === 0;
                    slim[i].mod1 = m === mod - 1;
                    slim[i].index = i;
                    slim[i].colWidth = mod === 0 ? 0 : (12 / mod);
                    slim[i].colOffset = slim[i].colWidth * m;
                    slim[i].firstOrMod0 = slim[i].first || slim[i].mod0;
                    slim[i].lastOrMod1 = slim[i].last || slim[i].mod1;
                    r += options.fn(slim[i]);
                }
            }
            return r;
        },

        /**
        * Loop through a certain number of times.
        **/
        loop: function (options) {
            var arr = new Array(options.hash.end);
            return Handlebars.helpers.each(arr, options);
        },

        /**
        * Overriding default markdown helper.
        * See notes above for more information.
        **/
        markdown: function (options) {
            var md = getMarked(options.fn(this)),
                nl = typeof options.hash.newline !== 'undefined' ? options.hash.newline : true;
            return nl ? newline(md) : md;
        },

        /**
        * If settings say to render, wrap content in div
        **/
        draft: function (options) {
            return stache.config.draft ? ('<div class="draft">\r\n\r\n' + getMarked(options.fn(this)) + '\r\n\r\n</div>') : '';
        },

        /**
        * Return the current count for the required property
        **/
        count: function (prop) {
            if (typeof counts[prop] === 'undefined') {
                counts[prop] = 0;
            }
            return counts[prop];
        },

        /**
        * Increment the count for the required property
        **/
        increment: function (prop) {
            counts[prop] = typeof counts[prop] === 'undefined' ? 0 : (counts[prop] + 1);
        },

        /**
        * Render a file.  Search path order: partial, absolute, relative, content folder
        **/
        include: function (file, context, options) {

            var r,
                template,
                fileWithPath,
                c,
                hideYFM,
                indent,
                indentString,
                render,
                fixNewline,
                escape,
                src,
                start,
                end;

            if (typeof options === 'undefined') {
                options = context;
                context = this;
            }

            // Increment sidebarCurrentDepth if it exists
            if (options.hash.sidebarCurrentDepth) {
                options.hash.sidebarCurrentDepth = parseInt(options.hash.sidebarCurrentDepth) + 1;
            }

            r = '';
            template = '';
            fileWithPath = file;
            c = merge(context, options.hash);
            hideYFM = typeof options.hash.hideYFM !== 'undefined' ? options.hash.hideYFM : true;
            render = typeof options.hash.render !== 'undefined' ? options.hash.render : true;
            fixNewline = typeof options.hash.fixNewline !== 'undefined' ? options.hash.fixNewline : true;
            escape = typeof options.hash.escape !== 'undefined' ? options.hash.escape : false;
            indent = options.hash.indent || 0;

            if (typeof Handlebars.partials[fileWithPath] !== 'undefined') {
                template = Handlebars.partials[fileWithPath];
            } else {
                if (!fs.existsSync(fileWithPath)) {
                    if (typeof this.page !== 'undefined' && this.page.src) {
                        src = this.page.src;
                    } else if (typeof context.page !== 'undefined' && context.page.src) {
                        src = context.page.src;
                    }

                    if (src) {
                        fileWithPath = src.substr(0, src.lastIndexOf('/')) + '/' + file;
                    }

                    if (!fs.existsSync(fileWithPath)) {
                        fileWithPath = stache.config.content + file;
                        if (!fs.existsSync(fileWithPath)) {
                            fileWithPath = '';
                        }
                    }
                }

                if (fileWithPath !== '') {
                    template = fs.readFileSync(fileWithPath).toString('utf8');
                }
            }

            // Allows for raw includes
            if (typeof template === 'string' && render) {
                r = Handlebars.compile(template)(c);
            } else if (!render) {
                r = template;
            }

            // Many text editors add a trailing newline when saving a source file.  Strip it if it's there.
            if (r.charAt(r.length - 1) === '\n') {
                r = r.substr(0, r.length - 1);
            }

            // I spent an entire day tracking down this bug.
            // Files created on different systems with different line endings freaked this out.
            if (fixNewline) {
                r = newline(r);
            }

            // Hide YAML Front Matter
            if (hideYFM && (r.match(/---/g) || []).length > 1) {
                start = r.indexOf('---') + 1;
                end = r.indexOf('---', start);
                r = r.substr(end + 3);
            }

            if (indent > 0) {
                indentString = new Array(indent + 1).join(' ');
                r = indentString + r.replace(/\n/g, '\n' + indentString);
            }

            if (escape) {
                r = r
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }

            return new Handlebars.SafeString(r);
        },

        /**
        * Supports object + arrays
        **/
        length: function (collection) {
            var length,
                prop;

            if (collection && collection.length) {
                return collection.length;
            }

            length = 0;
            for (prop in collection) {
                if (collection.hasOwnProperty(prop)) {
                    length++;
                }
            }
            return length;
        },

        /**
        * Total all coverage from instanbul report
        **/
        withCoverageTotal: function (collection, property, options) {

            var file,
                r = {
                    total: 0,
                    covered: 0,
                    skipped: 0,
                    pct: 0
                };

            for (file in collection) {
                if (collection[file].hasOwnProperty(property)) {
                    r.total += parseInt(collection[file][property].total);
                    r.covered += parseInt(collection[file][property].covered);
                    r.skipped += parseInt(collection[file][property].skipped);
                }
            }

            if (r.total > 0) {
                r.pct = (r.covered / r.total) * 100;
            }

            if (r.pct < 50) {
                r.cssClass = 'danger';
            } else if (r.pct < 80) {
                r.cssClass = 'warning';
            } else {
                r.cssClass = 'success';
            }

            if (options.hash.fixed && r.pct !== 100) {
                r.pct = toFixed(r.pct, options.hash.fixed);
            }

            return options.fn(r, options);
        },

        /**
        * I don't believe this works
        **/
        raw: function (options) {
            return '<raw>' + options.fn(this) + '</raw>';
        },

        /**
        *
        **/
        withFirstProperty: function (collection, options) {
            var property;
            for (property in collection) {
                if (collection.hasOwnProperty(property)) {
                    return options.fn(collection[property]);
                }
            }
        },

        /**
        *
        **/
        percent: function (dividend, divisor, options) {
            var r = 0;
            if (dividend === divisor) {
                r = 100;
            } else if (divisor !== 0) {
                r = Math.round(dividend / divisor);
            }
            return r.toFixed(options.hash.toFixed || 0);
        },

        /**
        * Many functions of the site, including grunt-yeomin fails on windows line endings.
        * This helpers replaces those.
        **/
        newline: function (text) {
            return newline(text);
        },

        /**
        * Same as newline method but wraps context
        **/
        withNewline: function (options) {
            return newline(options.fn(this));
        },

        /**
        * Block helper to emulate the following logic:
        * If Globally true then
        *   Unless locally false (blank is true)
        *     TRUE
        * Else if globally false then
        *   If locally true then
        *     TRUE
        **/
        inherit: function (globally, locally, options) {
            var r = false;
            if (globally) {
                r = typeof locally === 'undefined' || locally.toString() !== 'false';
            } else {
                r = locally;
            }
            return r ? options.fn(this) : options.inverse(this);
        },

        /**
        * Consistently generate the edit link for a file in GitHub
        **/
        editInGitHubLink: function (options) {
            var src = options.hash.src || (typeof this.page !== 'undefined' ? this.page.src : '');
            return [
                stache.config.github_protocol,
                stache.config.github_base,
                '/',
                stache.config.github_org,
                '/',
                stache.config.github_repo,
                '/blob/',
                stache.config.github_branch,
                '/',
                src
            ].join('');
        },

        /**
        * Consistently generate the edit link for a file in Prose
        **/
        editInProseLink: function (options) {
            var src = options.hash.src || (typeof this.page !== 'undefined' ? this.page.src : '');
            return [
                stache.config.prose_base,
                '/#',
                stache.config.github_org,
                '/',
                stache.config.github_repo,
                '/edit/',
                stache.config.github_branch,
                '/',
                src
            ].join('');
        },

        /**
        * Consistently generate the trigger link for a site rebuild
        **/
        triggerSiteRebuildLink: function () {
            return [
                stache.config.kudu_protocol,
                stache.config.kudu_repo,
                stache.config.kudu_suffix
            ].join('');
        },

        /**
        * Consistently generate the GitHub repo link (for site rebuild)
        **/
        gitSourceLink: function () {
            return [
                stache.config.github_protocol,
                stache.config.github_token,
                '@',
                stache.config.github_base,
                '/',
                stache.config.github_org,
                '/',
                stache.config.github_repo,
                '.git'
            ].join('');
        },

        /**
        * Allows context against specific item in object
        **/
        withItem: function (object, options) {
            return typeof object[options.hash.key] !== 'undefined' ? options.fn(object[options.hash.key]) : '';
        },

        /**
        * Removes the extension from a filename
        **/
        removeExt: function (filename) {
            var dot = filename.lastIndexOf('.');
            return dot > -1 ? filename.substr(0, dot) : filename;
        },

        /**
        * Is the item an array or object?
        **/
        isArray: function (item, options) {
            return Handlebars.Utils.isArray(item) ? options.fn(this) : options.inverse(this);
        },

        /**
        * Helper for converting Sandcastle types to Prism types
        **/
        getPrismType: function (type) {
            var r = type;
            switch (type.toUpperCase()) {
                case 'C#':
                case 'VB':
                    r = 'csharp';
                break;
                case 'C++':
                    r = 'cpp';
                break;
            }
            return r;
        },

        /**
        * Used instead of us having to pass the nav_links object around in the context.
        **/
        withNavLinks: function (options) {
            //return Handlebars.helpers.each(options.hash.nav_links || bypassContext.nav_links, options);
            return Handlebars.helpers.eachWithMod(options.hash.nav_links || bypassContext.nav_links, options);
        },

        /**
        * If the user specified a maximum parent depth, make sure this is within in.
        * This is still a WIP.
        **/
        withinParentDepth: function (options) {
            var a = options.hash.sidebarCurrentDepth || -1,
                b = options.hash.sidebarParentDepth || -1;

            if (a === -1 || b === -1) {
                return options.fn(this);
            } else {
                return options.fn(this);
            }
        },

        /**
        * Normalizes Sandcastle URL
        **/
        normalizeSandcastleUrl: function (url) {
            var u = url || '';

            return u.indexOf('://') > -1 ? u : ('../' + u
                .replace('.htm', '/')
                .replace('html/', ''));
        },

        /**
        * Creates a url "slug" based on a string
        * This sucks, but needs to be the same implementation in stache.js
        **/
        slugify: function (title) {
            return title
                .toLowerCase()
                .replace(/ /g, '-')
                .replace(/[^\w-]+/g, '');
        },

        /**
        * Last chance for us to modify the page's content at build-time.
        **/
        stachePostProcess: function (options) {
            var html = options.fn(this);

            if (stache.postHandlebarsHooks && stache.postHandlebarsHooks.length > 0) {
                stache.postHandlebarsHooks.forEach(function (hook) {
                    html = hook(html);
                });
            }

            return html;
        },

        /**
        * Uglifys a block of JavaScript
        **/
        uglify: function (options) {
            return UglifyJS.minify(options.fn(this), {
                fromString: true
            }).code;
        }

    });
};
