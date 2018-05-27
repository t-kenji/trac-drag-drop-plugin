jQuery(document).ready(function($) {
    var console = window.console;
    if (!console || !console.log) {
        console = {'log': function() { }};
    }
    /* From 0.12-stable/trac/htdocs/js/babel.js */
    var babel = window.babel;
    if (babel.format('%(arg)d%%', {arg: 1}) !== '1%') {
        babel = $.extend({}, babel);
        babel.format = (function() {
            var formatRegex = /%(?:(?:\(([^\)]+)\))?([disr])|%)/g;
            var babel = {};
            return function() {
                var arg, string = arguments[0], idx = 0;
                if (arguments.length == 1)
                    return string;
                if (arguments.length == 2 && typeof arguments[1] == 'object')
                    arg = arguments[1];
                else {
                    arg = [];
                    for (var i = 1, n = arguments.length; i != n; ++i)
                        arg[i - 1] = arguments[i];
                }
                return string.replace(formatRegex, function(all, name, type) {
                    if (all == '%%')
                        return '%';
                    var value = arg[name || idx++];
                    return (type == 'i' || type == 'd') ? +value : value; 
                });
            };
        })();
    }
    var _ = (function() {
        var tx = babel.Translations;
        if (tx && tx.get) {
            var rv = tx.get('tracdragdrop-js');
            return function() {
                return rv.gettext.apply(rv, arguments);
            };
        }
        return window.gettext;
    })();

    if (window.Clipboard || false) {
        $('#content').delegate('a.trac-rawlink', 'dragstart', function(event) {
            var transfer = event.originalEvent.dataTransfer || false;
            if (!transfer || transfer.constructor != Clipboard) {
                return;
            }
            var href = this.href;
            var name = href.substring(href.lastIndexOf('/') + 1);
            name = decodeURIComponent(name).replace(/:/g, '_');
            var data = ['application/octet-stream', name, href].join(':');
            try {
                transfer.setData('DownloadURL', data);
            }
            catch (e) {
                console.log(babel.format('%s: %s', e.name, e.message), e);
            }
        });
    }
    var tracdragdrop = window._tracdragdrop || undefined;
    var form_token = window.form_token || undefined;
    if (!tracdragdrop || !form_token) {
        return;
    }
    var attachments = $('div#content > div#attachments');
    var attachfile = $('form#attachfile');
    var viewpage = attachfile.length !== 0;
    var xhrHasUpload = window.XMLHttpRequest &&
                       !!(new XMLHttpRequest()).upload;
    var hasFileReader = !!window.FileReader;
    var hasFormData = !!window.FormData;
    var hasDragAndDrop = xhrHasUpload && hasFileReader;
    var toBlob = (function() {
        try {
            new Blob(['data'], {type: 'application/octet-stream'});
            return function(parts, mimetype) {
                return new Blob(parts, {type: mimetype});
            };
        }
        catch (e) { }
        var BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder ||
                          window.MozBlobBuilder || window.MSBlobBuilder ||
                          undefined;
        if (BlobBuilder) {
            return function(parts, mimetype) {
                var builder = new BlobBuilder();
                var length = parts.length;
                for (var i = 0; i < length; i++) {
                    builder.append(parts[i].buffer);
                }
                return builder.getBlob(mimetype);
            };
        }
        return undefined;
    })();
    var containers = {list: null, queue: null, dropdown: null};
    var queueItems = [];
    var queueCount = 0;
    var compact = attachments.find('form#attachfile').length === 0 &&
                  attachments.find('div > dl.attachments').length === 0;

    function ajaxUpload(options) {
        var opts = $.extend({}, options);
        var upload = xhrHasUpload ? opts.upload : {};
        var headers = opts.headers || {};
        var data = opts.data;
        var isFormData = hasFormData && data instanceof FormData;
        var xhr;
        opts.xhr = function() {
            xhr = $.ajaxSettings.xhr();
            for (var type in upload) {
                xhr.upload.addEventListener(type, upload[type], false);
            }
            return xhr;
        };
        opts.type = 'POST';
        opts.dataType = 'text';
        opts.processData = false;
        opts.beforeSend = function(xhr, settings) {
            for (var name in headers) {
                xhr.setRequestHeader(name, headers[name]);
            }
            if (isFormData) {
                settings.data = data;
            }
        };
        opts.complete = function(jqxhr, status) {
            for (var type in upload) {
                xhr.upload.removeEventListener(type, upload[type], false);
            }
            xhr = undefined;
        };
        if (isFormData) {
            delete opts.data;
            opts.contentType = false;
        }
        else {
            opts.contentType = 'application/octet-stream';
        }
        delete opts.headers;
        delete opts.progress;
        return $.ajax(opts);
    }

    function textNode(val, d) {
        return (d || document).createTextNode(val);
    }

    function generateTracLink(val) {
        var text = 'attachment:' + val;
        if (!/[ \t\f\v"']/.test(val))
            return text;
        if (!/"/.exec(val))
            return 'attachment:"' + val + '"';
        if (!/'/.exec(val))
            return "attachment:'" + val + "'";
        return text; // XXX maybe corrupted link
    }

    function generateImageMacro(val) {
        return '[[Image(' + val + ')]]';
    }

    function refreshAttachmentsList(src) {
        src = $('<div />').html(src);
        var list = containers.list;
        var srcList = src.find(compact ? 'ul' : 'dl.attachments');
        var n = srcList.children(compact ? 'li' : 'dt').length;
        if (list !== null) {
            containers.dropdown.appendTo(document.body);
            list.empty().append(srcList.contents());
        }
        else {
            if (compact) {
                attachments.prepend(src.find('div#attachments').contents())
                           .children('.foldable')
                           .enableFolding(true, viewpage);
            }
            else {
                containers.queue.before(srcList);
            }
            setContainerList(srcList);
        }
        var count = attachments.find('span.trac-count');
        var countText = count.text();
        if (/[0-9]/.test(countText)) {
            count.text(countText.replace(/[0-9]+/, n));
        }
        attachments.removeClass('collapsed');
    }

    function generateFilenamePrefix(now) {
        function pad0(val, size) {
            var pad;
            switch (size) {
                case 2: pad = '00'; break;
                case 4: pad = '0000'; break;
            }
            return (pad + val).slice(-size);
        }
        now = now || new Date();
        now = {year: now.getFullYear(), month: now.getMonth() + 1,
               date: now.getDate(), hours: now.getHours(),
               minutes: now.getMinutes(), seconds: now.getSeconds()};
        return [
            'image-',
            pad0(now.year, 4), pad0(now.month, 2), pad0(now.date, 2),
            '-',
            pad0(now.hours, 2), pad0(now.minutes, 2), pad0(now.seconds, 2),
        ].join('');
    }

    function generateFilename(prefix, mimetype, n) {
        var suffix;
        switch (mimetype) {
        case 'image/png':
        case 'image/jpeg':
        case 'image/gif':
            suffix = '.' + mimetype.substring(6);
            break;
        default:
            suffix = mimetype.substring(0, 6) === 'image/'
                   ? '.' + mimetype.substring(6)
                   : '.dat';
            break;
        }
        return n === undefined ? (prefix + suffix)
                               : (prefix + '-' + n + suffix);
    }

    function shortenDataUri(uri) {
        if (/^data:/.test(uri)) {
            uri = uri.substring(0, 72) + '...';
        }
        return uri;
    }

    function createPasteArea(form, container) {
        var message = _("Paste an image to attach");
        var events = {};
        var enable = function() {
            editable.empty();
            this.setAttribute('contenteditable', 'true');
            this.focus();
        };
        var disable = function() {
            editable.empty();
            this.removeAttribute('contenteditable');
            this.blur();
        };
        events.mouseenter = function() {
            editable.triggerHandler('focus');
        };
        events.focus = function() { enable.call(this) };
        events.blur = function() { disable.call(this) };
        events.keyup = function() { editable.empty() };
        events.keypress = function(event) {
            return event.ctrlKey === true || event.metaKey === true;
        };
        events.paste = function(event) {
            var options = getOptionsFrom(form);
            var prefix = generateFilenamePrefix();

            if (event.originalEvent.clipboardData &&
                event.originalEvent.clipboardData.items)
            {
                var images = [];
                $.each(event.originalEvent.clipboardData.items, function() {
                    if (/^image\//i.test(this.type)) {
                        images.push(this.getAsFile());
                    }
                });
                switch (images.length) {
                case 0:
                    alert(_("No available image on your clipboard"));
                    return false;
                case 1:
                    var o = {filename: generateFilename(prefix,
                                                        images[0].type)};
                    prepareUploadItem(images[0], $.extend(o, options));
                    break;
                default:
                    $.each(images, function(idx, image) {
                        var o = {filename: generateFilename(
                                                prefix, image.type, idx + 1)};
                        prepareUploadItem(image, $.extend(o, options));
                    });
                    break;
                }
                startUpload();
                return false;
            }

            setTimeout(function() {
                var element = editable.find('img');
                editable.empty();
                if (element.length === 0) {
                    alert(_("No available image on your clipboard"));
                    return;
                }
                var o = $.extend({filename: prefix + '.png'}, options);
                var image = element.get(0);
                image.removeAttribute('width');
                image.removeAttribute('height');
                if ((image.complete === true ?
                     image.naturalWidth : image.width) !== 0)
                {
                    prepareUploadImageUsingCanvas(image, o);
                    return;
                }
                var events = {};
                events.load = function() {
                    element.unbind();
                    element = image = undefined;
                    prepareUploadImageUsingCanvas(this, o);
                };
                events.error = function(e) {
                    element.unbind();
                    element = image = undefined;
                    alert(babel.format(
                        _("Cannot load an image from '%(src)s'."),
                        {src: shortenDataUri(this.src)}));
                };
                $(image).bind(events);
            }, 1);
        };
        var editable = $('<div />')
            .addClass('tracdragdrop-paste beautytips')
            .attr('title',
                  _("You can attach an image from your clipboard directly " +
                    "with CTRL-V or \"Paste\" on the context menu."))
            .attr('data', message)
            .bind(events);
        container.append(editable);
        editable.css({width: editable.width() + 'px',
                      height: editable.height() + 'px'});
    }

    function prepareUploadImageUsingCanvas(image, options) {
        var filename = options.filename;
        var canvas = image.ownerDocument.createElement('canvas');
        canvas.width = image[image.naturalWidth !== undefined ?
                             'naturalWidth' : 'width'];
        canvas.height = image[image.naturalHeight !== undefined ?
                              'naturalHeight' : 'height'];
        var context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        var data;
        try {
            if (canvas.toBlob) {
                canvas.toBlob(function(data) {
                    prepareUploadItem(data, options);
                    startUpload();
                });
                return;
            }
            if (canvas.getAsFile) {
                data = canvas.getAsFile(filename);
            }
            else if (canvas.mozGetAsFile) {
                data = canvas.mozGetAsFile(filename);
            }
            else if (canvas.toDataURL) {
                data = convertBlobFromDataUri(canvas.toDataURL('image/png'));
            }
        }
        catch (e) {
            console.log(babel.format('%s: %s', e.name, e.message), e);
        }
        if (!data) {
            alert(babel.format(_("Cannot load an image from '%(src)s'."),
                               {src: shortenDataUri(image.src)}));
            return;
        }
        prepareUploadItem(data, options);
        startUpload();
    }

    function prepareUploadItem(item, options) {
        options = options || {};
        var key = '#' + ++queueCount;
        var filename = 'filename' in options ? options.filename : item.name;
        var size = 'size' in options ? options.size : item.size;
        var description = 'description' in options ? options.description : '';
        var replace = !!options.replace;
        var element, progress, cancel, message, error;
        filename = $.trim(filename).replace(/[\x00-\x1f]/g, '');
        if (xhrHasUpload) {
            progress = $('<span />').addClass('tracdragdrop-progress')
                                    .append($('<div />'));
        }
        cancel = $('<span />').addClass('tracdragdrop-cancel')
                              .text('×');
        message = $('<span />').addClass('tracdragdrop-message');
        element = $(compact ? '<li />' : '<dt />')
                  .attr('data-tracdragdrop-key', key)
                  .append(cancel);
        if (progress !== undefined) {
            element.append(textNode(' '), progress);
        }
        element.append(textNode(' ' + filename), message);
        containers.queue.append(element);
        if (!xhrHasUpload && !hasFileReader) {
            queueItems.push({element: element, message: message, key: key});
            return key;
        }
        if (tracdragdrop.max_size > 0 && size > tracdragdrop.max_size) {
            error = babel.format(
                _("Exceeded maximum allowed file size (%(size)s bytes)"),
                {size: tracdragdrop.max_size});
        }
        else if (size === 0) {
            error = _("Can't upload empty file");
        }
        if (error === undefined) {
            var data = {};
            data.data = item;
            data.filename = filename;
            data.description = description;
            data.replace = replace;
            data.size = size;
            data.element = element;
            data.message = message;
            data.xhr = null;
            data.key = key;
            queueItems.push(data);
        }
        else {
            message.text(error).addClass('warning system-message');
        }
        return key;
    }

    function cancelUploadItem() {
        var item = $(this);
        var key = item.attr('data-tracdragdrop-key');
        var found = false;
        $.each(queueItems, function(idx, val) {
            if (val.key === key) {
                finishUploadItem(key, _("Canceled"));
                var xhr = val.xhr;
                val.xhr = false;
                val.data = null;
                if (xhr) {
                    xhr.abort();
                }
                found = true;
                return false;
            }
        });
        if (!found) {
            item.remove();
        }
    }

    function uploadItem(entry) {
        function setProgress(rate) {
            var val = rate !== null
                    ? Math.min(rate, 1) * 100
                    : (parseFloat(bar.css('width')) + 10) % 100;
            bar.css('width', val + '%');
            if (rate !== null) {
                loading.text(babel.format(_("Uploaded %(percent)s%%"),
                                          {percent: val.toPrecision(3)}));
            }
        }
        var loading = $('<span />').addClass('tracdragdrop-loading');
        var bar = entry.element.find('.tracdragdrop-progress > div');
        var key = entry.key;
        entry.message.empty().append(loading);
        var options = {};
        options.url = tracdragdrop['new_url'];
        options.headers = {
            'X-TracDragDrop-Filename': encodeURIComponent(entry.filename),
            'X-TracDragDrop-Compact': compact ? '1' : '0'};
        if (entry.replace) {
            options.headers['X-TracDragDrop-Replace'] = '1';
        }
        if (xhrHasUpload) {
            var upload = {};
            options.upload = upload;
            upload.progress = function(event) {
                setProgress(event.lengthComputable ? event.loaded / event.total
                                                   : null);
            };
            upload.loadstart = function() { setProgress(0) };
            upload.loadend = function() {
                if (entry.xhr) {
                    setProgress(1);
                }
            };
        }
        else {
            loading.text(_("Uploading..."));
        }
        options.success = function(data, status, xhr) {
            finishUploadItem(key);
            if (data) {
                refreshAttachmentsList(data);
            }
        };
        options.error = function(xhr, status, error) {
            var msg;
            switch (status) {
            case 'timeout':
                msg = _("Timed out");
                break;
            case 'abort':
                msg = _("Aborted");
                break;
            default: // 'error'
                if (xhr) {
                    msg = xhr.responseText;
                    if (/^\s*<(?:!DOCTYPE|\?xml)/.test(msg)) {
                        msg = xhr.statusText + ' (' + xhr.status + ')';
                    }
                }
                else {
                    msg = status;
                }
                break;
            }
            finishUploadItem(key, msg);
        };
        if (hasFormData) {
            var data = new FormData();
            data.append('__FORM_TOKEN', form_token);
            data.append('attachment', entry.data, entry.filename);
            data.append('compact', compact ? '1' : '0');
            data.append('description', entry.description);
            if (entry.replace)
                data.append('replace', '1');
            options.data = data;
        }
        else {
            options.data = entry.data;
        }
        if (xhrHasUpload) {
            entry.xhr = ajaxUpload(options);
            return;
        }
        var reader = new FileReader();
        var events = {};
        events.loadend = function() {
            for (var name in events) {
                reader.removeEventListener(name, events[name], false);
            }
        };
        events.error = function() {
            options.error(null, reader.error.toString());
        };
        events.load = function() {
            options.data = reader.result;
            entry.xhr = ajaxUpload(options);
        };
        for (var name in events) {
            reader.addEventListener(name, events[name], false);
        }
        entry.xhr = false;
        reader.readAsArrayBuffer(options.data);
    }

    function finishUploadItem(key, message) {
        $.each(queueItems, function(idx, val) {
            if (val.key === key) {
                queueItems.splice(idx, 1);
                var element = val.element;
                if (message === undefined) {
                    element.remove();
                    var filename = val.filename;
                    var title = babel.format(
                        tracdragdrop.no_image_msg,
                        {id: filename, parent: tracdragdrop.parent_name});
                    $('#content img[src*="/common/attachment.png"]')
                        .each(function()
                    {
                        var match;
                        if (this.title === title) {
                            this.title = '';
                            match = true;
                        }
                        if (this.alt === title) {
                            this.alt = '';
                            match = true;
                        }
                        if (match === true) {
                            this.src = tracdragdrop.raw_parent_url +
                                       encodeURIComponent(filename);
                        }
                    });
                }
                else {
                    element.find('.tracdragdrop-message')
                           .text(message)
                           .addClass('warning system-message');
                }
                return false;
            }
        });
        nextUploadItem();
    }

    function nextUploadItem() {
        if (queueItems.length === 0) {
            return;
        }
        $.each(queueItems, function(idx, val) {
            if (val.xhr === null) {
                uploadItem(val);
                return false;
            }
        });
    }

    function startUpload() {
        nextUploadItem();
    }

    function prepareAttachForm() {
        var file = $('<input type="file" name="attachment" />')
                   .attr('multiple', 'multiple');
        var replace = $('<label />').append(
            $('<input type="checkbox" name="replace" value="1" />'),
            textNode(' ' + _("Replace existing attachment of the same name")));
        var description = $('<label />').append(
            textNode(_("Description:") + ' '),
            $('<input type="text" name="description" size="60" value="" />'));
        var fieldset = $('<fieldset />');
        var paste;
        fieldset.append($('<legend />').text(_("Add Attachment")), file);
        if (hasDragAndDrop) {
            fieldset.append(textNode(
                                ' ' + _("You may use drag and drop here.")));
            if ('onpaste' in document.body) {
                paste = $('<div />');
                fieldset.append(paste);
            }
        }
        fieldset.append($('<br />'), description, $('<br />'), replace);
        var form = $('<form enctype="multipart/form-data" />')
                   .attr({method: 'post', action: tracdragdrop['new_url']})
                   .addClass('tracdragdrop-form')
                   .append(fieldset);
        var queue;
        var hidden = false;
        if (attachfile.length === 0) {
            queue = $('<ul />').addClass('tracdragdrop-queue');
            attachfile = form.attr('id', 'attachfile');
            attachments.append(queue, form);
        }
        else if (compact) {
            queue = $('<ul />').addClass('tracdragdrop-queue');
            attachfile.submit(function() {
                form.toggle();
                attachfile.find(':submit').blur();
                return false;
            });
            attachments.after(queue, form);
            hidden = true;
        }
        else {
            form.attr('id', 'attachfile');
            attachfile.replaceWith(form);
            attachfile = form;
            queue = $('<dl />').addClass('attachments tracdragdrop-queue');
            var dl = form.parent().children('dl.attachments');
            if (dl.length === 0) {
                form.before(queue);
            }
            else {
                dl.after(queue);
            }
        }
        if (paste !== undefined) {
            createPasteArea(form, paste);
        }
        containers.queue = queue;
        if (xhrHasUpload || file.get(0).files && hasFileReader) {
            queue.delegate('dt, li', 'click', cancelUploadItem);
            file.bind('change', function() {
                var options = getOptionsFrom(form);
                $.each(this.files, function() {
                    prepareUploadItem(this, options);
                });
                resetForm(this.form);
                startUpload();
            });
        }
        else {
            queue.delegate('dt, li', 'click', function() {
                var item = $(this);
                var key = item.attr('data-tracdragdrop-key');
                var iframe = $('#tracdragdrop-attachfile-iframe');
                if (iframe.attr('data-tracdragdrop-key') === key) {
                    resetForm(form.get(0));
                    file.attr('disabled', false);
                    iframe.attr('src', 'about:blank'); // cancel upload
                    iframe.remove();
                }
                cancelUploadItem.call(this);
            });
            var token = $('<input type="hidden" name="__FORM_TOKEN" />');
            form.prepend($('<div />').css('display', 'none').append(token));
            file.bind('change', function() {
                token.val(form_token);
                var key;
                var form = $(this.form);
                var iframe = $('<iframe' +
                    ' width="1" height="1" src="about:blank"' +
                    ' id="tracdragdrop-attachfile-iframe"' +
                    ' name="tracdragdrop-attachfile-iframe"' +
                    ' style="display:none"></iframe>');
                iframe.appendTo(form);
                iframe.bind('load', function() {
                    var data = iframe.get(0).contentWindow.document.body;
                    var valid = data.className == 'tracdragdrop-attachments';
                    data = data.innerHTML;
                    form.attr('target', '');
                    resetForm(form.get(0));
                    iframe.attr('src', 'about:blank'); // stop loading icon
                    iframe.remove();
                    iframe = null;
                    if (valid) {
                        finishUploadItem(key);
                        refreshAttachmentsList(data);
                    }
                    else {
                        var message = $('<div />').html(data).text();
                        finishUploadItem(key, message);
                    }
                    file.attr('disabled', false);
                });
                form.attr('target', iframe.attr('name'));
                form.focus();
                form.submit();
                file.attr('disabled', true);
                var options = getOptionsFrom(form);
                var filename = this.value;
                filename = filename.substring(filename.lastIndexOf('\\') + 1);
                filename = filename.substring(filename.lastIndexOf('/') + 1);
                options.filename = filename;
                options.size = -1;
                key = prepareUploadItem(null, options);
                iframe.attr('data-tracdragdrop-key', key);
                $.each(queueItems, function(idx, val) {
                    if (val.key === key) {
                        val.message.empty().append(
                            $('<span />').addClass('tracdragdrop-loading')
                                         .text(_("Uploading...")));
                        return false;
                    }
                });
            });
        }
        if (hidden) {
            form.hide();
        }
        prepareDragEvents(form);
    }

    function resetForm(form) {
        var elements = form.elements;
        var replace = elements['replace'];
        var description = elements['description'];
        var values = {replace: replace.checked,
                      description: description.value};
        form.reset();
        replace.checked = values.replace;
        description.value = values.description;
    }

    function setContainerList(element) {
        var dropdown, icon, menu, del;
        var fields = {traclink: null, macro: null};
        var stripHostRegexp = new RegExp('^[^:]+://[^/:]+(?::[0-9]+)?');

        function getFilename(rawlink) {
            var name = $(rawlink).attr('href');
            name = name.substring(name.lastIndexOf('/') + 1);
            return decodeURIComponent(name);
        }
        function getUrl(rawlink, action) {
            var url = $(rawlink).attr('href').replace(stripHostRegexp, '');
            var base_url = tracdragdrop.base_url
            var length = (base_url + 'raw-attachment/').length;
            return base_url + 'tracdragdrop/delete/' + url.substring(length);
        }
        function showIcon(item, rawlink) {
            var filename = getFilename(rawlink);
            var vals = {traclink: generateTracLink(filename),
                        macro: generateImageMacro(filename)};
            item.append(dropdown);
            $.each(vals, function(idx, val) { fields[idx].val(val) });
        }

        fields.traclink =
            $('<input type="text" readonly="readonly" size="30" />')
            .click(function() { this.select() });
        fields.macro = fields.traclink.clone(true);
        del = $('<div  />').append($('<strong />').text('\u00d7\u00a0'),
                                   textNode(_("Delete attachment")))
                           .click(function() {
            var item = $(this).parents('dt, li');
            var rawlink = item.find('a.trac-rawlink');
            var filename = getFilename(rawlink);
            var message = babel.format(
                _("Are you sure you want to delete '%(name)s'?"),
                {name: filename});
            if (confirm(message)) {
                var url = getUrl(rawlink, 'delete');
                $.ajax({
                    url: url,
                    type: 'POST',
                    data: '__FORM_TOKEN=' + form_token,
                    success: function() {
                        dropdown.appendTo(document.body);
                        var count = attachments.find('span.trac-count');
                        var countText = count.text();
                        if (/[0-9]/.test(countText)) {
                            var n = item.parent().find(item[0].tagName).length;
                            count.text(countText.replace(/[0-9]+/,
                                                         Math.max(n - 1, 0)));
                        }
                        item.add(item.next('dd')).remove();
                    },
                    error: function(xhr, status, error) {
                        alert(xhr.responseText || status);
                    }
                });
            }
            menu.hide();
        });
        menu = $.htmlFormat([
            '<table>',
            ' <tbody>',
            '  <tr>',
            '   <td>$1</td>',
            '   <td class="tracdragdrop-traclink"></td>',
            '  </tr>',
            '  <tr>',
            '   <td>$2</td>',
            '   <td class="tracdragdrop-macro"></td>',
            '  </tr>',
            '  <tr class="tracdragdrop-menuitem">',
            '   <td colspan="2" class="tracdragdrop-delete"></td>',
            '  </tr>',
            ' </tbody>',
            '</table>'].join(''), _("TracLink"), _("Image macro"));
        menu = $('<div />').addClass('tracdragdrop-menu')
                           .html(menu);
        menu.find('.tracdragdrop-traclink').append(fields.traclink);
        menu.find('.tracdragdrop-macro').append(fields.macro);
        menu.find('.tracdragdrop-delete').append(del);
        menu.hide();
        menu.find('tr').bind('mouseenter', function() {
            $(this).find('input[type=text]').each(function() { this.click() });
        });
        icon = $('<div />')
               .addClass('tracdragdrop-icon')
               .text('\u25bc')
               .bind('click', function() { menu.toggle() });
        dropdown = $('<div />')
                  .addClass('tracdragdrop-dropdown')
                  .append(icon, menu);
        element.delegate('dt, li', 'mouseenter', function() {
            if (menu.css('display') === 'none') {
                var item = $(this);
                showIcon(item, item.children('a.trac-rawlink'));
            }
        });
        element.delegate('dt > a, li > a', 'click', function(event) {
            if (event.which > 1 || !event.altKey) {
                return;
            }
            var self = $(this);
            var rawlink = self.next('a.trac-rawlink');
            if (rawlink.length === 0) {
                rawlink = self.prev('a.trac-rawlink');
            }
            if (rawlink.length === 0) {
                return;
            }
            var item = rawlink.parent();
            if ($.contains(item.get(0), dropdown.get(0))) {
                menu.toggle();
            }
            else {
                showIcon(item, rawlink);
                menu.show();
            }
            return false;
        });
        $('html').click(function(event) {
            if (!$.contains(dropdown.get(0), event.target)) {
                menu.hide();
                dropdown.appendTo(document.body);
            }
        });
        dropdown.appendTo(document.body);

        containers.list = element;
        containers.dropdown = dropdown;
    }

    function convertBlobsFromUriList(urilist) {
        var items = [];
        $.each(urilist.split(/\n/), function(idx, line) {
            var blob = convertBlobFromDataUri(line);
            if (blob) {
                items.push(blob);
            }
        });
        return items;
    }

    function convertBlobFromDataUri(uri) {
        var re = /^data:([^,;]+)((?:;[^;,]*)*),([^\n]*)/;
        var match = re.exec(uri);
        if (!match) {
            return null;
        }
        var mimetype = match[1].toLowerCase();
        switch (mimetype) {
        case 'image/png':
        case 'image/jpeg':
        case 'image/gif':
            break;
        default:
            return null;
        }
        var attrs = match[2].substring(1);
        var body = match[3];
        $.each(attrs.split(/;/), function(idx, val) {
            switch (val) {
            case 'base64':
                body = atob(body);
                break;
            }
        });
        var length = body.length;
        var buffer = new Uint8Array(length);
        for (var i = 0; i < length; i++) {
            buffer[i] = body.charCodeAt(i);
        }
        return toBlob([buffer], mimetype);
    }

    function getOptionsFrom(form) {
        var replace = form.find('[name=replace]');
        var options = {replace: replace[0].checked};
        var description = form.find('[name=description]').val();
        if (description)
            options.description = description;
        return options;
    }

    function prepareDragEvents(form) {
        var replace = form.find('[name=replace]')[0];
        var body = document.body;
        var elements = $('html');
        var mask = $('<div />');
        var indicator = $('<div />');
        var hint_texts = [_("You may replace files by dropping files with " +
                            "shift key"),
                          _("Existing files of the same name would be " +
                            "replaced with dropped files")];
        var hint = $('<span />');
        $('<span />')
            .append($('<strong />').text(_("Drop files to attach")),
                    $('<br />'), hint)
            .appendTo(indicator);
        var start_effect = function() {
            dragging = true;
            saved_replace = replace.checked;
            effect.show();
        };
        var stop_effect = function() {
            dragging = undefined;
            replace.checked = saved_replace;
            effect.hide();
        };
        var effect = $('<div />').addClass('tracdragdrop-dropeffect')
                                 .append(mask, indicator)
                                 .hide()
                                 .click(stop_effect)
                                 .appendTo(body);
        var dragging;
        var saved_replace;
        var prev_replace;
        var events = {};
        var type;
        events.dragstart = function(event) { dragging = false };
        events.dragend = function(event) { dragging = undefined };
        events.dragenter = function(event) {
            if (dragging === undefined) {
                var transfer = event.originalEvent.dataTransfer;
                var found;
                $.each(transfer.types, function(idx, type) {
                    type = '' + type;
                    switch (type) {
                    case 'Files':
                    case 'application/x-moz-file':
                        found = type;
                        return false;
                    case 'text/uri-list':
                        if (toBlob) {
                            found = type;
                        }
                        break;
                    }
                });
                if (found === undefined) {
                    return;
                }
                type = found;
                start_effect();
            }
            return !dragging;
        };
        events.dragleave = function(event) {
            if (dragging === true && event.target === mask.get(0)) {
                stop_effect();
            }
        };
        events.dragover = function(event) {
            if (dragging) {
                var checked = replace.checked = saved_replace || event.shiftKey;
                if (prev_replace !== checked) {
                    prev_replace = checked;
                    hint.text(hint_texts[checked ? 1 : 0]);
                }
            }
            return !dragging;
        };
        events.drop = function(event) {
            if (dragging !== true) {
                return;
            }
            var options = getOptionsFrom(form);
            stop_effect();
            var items;
            var transfer = event.originalEvent.dataTransfer;
            switch (type) {
            case 'Files':
            case 'application/x-moz-file':
                items = transfer.files;
                $.each(items, function() { prepareUploadItem(this, options) });
                break;
            case 'text/uri-list':
                var uris = transfer.getData(type);
                var prefix = generateFilenamePrefix();
                items = convertBlobsFromUriList(uris);
                switch (items.length) {
                case 1:
                    options.filename = generateFilename(prefix, items[0].type);
                    prepareUploadItem(items[0], options);
                    break;
                default:
                    $.each(items, function(idx, item) {
                        var o = {filename: generateFilename(prefix, item.type,
                                                            idx + 1)};
                        prepareUploadItem(item, $.extend(o, options));
                    });
                    break;
                }
                break;
            }
            if (items.length !== 0) {
                startUpload();
            }
            else {
                alert(_("No available image in the dropped data"));
            }
            items = undefined;
            return false;
        };
        elements.bind(events);
    }

    function initialize() {
        if (attachments.length === 0) {
            return;
        }
        var foldable = attachments.children('.foldable');
        if ($.fn.enableFolding && foldable.length !== 0) {
            setTimeout(function() {
                if (foldable.children('a').length === 0) {
                    foldable.enableFolding(true, viewpage);
                }
            }, 10);
        }
        $.each(compact ? ['div > ul', 'ul'] : ['div > dl.attachments'],
               function(idx, val)
        {
            var list = attachments.find(val);
            if (list.length !== 0) {
                setContainerList($(list.get(0)));
                return false;
            }
        });
        if (tracdragdrop.can_create) {
            prepareAttachForm();
        }
    }

    initialize();
});
