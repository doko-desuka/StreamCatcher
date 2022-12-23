'use strict';


import { FORMATS_PATTERN, isChrome } from './utils.js';


function sendBackgroundMessage(payload, callback) {
    if (isChrome()) {
        chrome.runtime.sendMessage(payload, callback);
    } else {
        const response = browser.runtime.sendMessage(payload);
        response.then(callback);
    }
}


function clearRequestsList() {
    document.getElementById('requests').innerHTML = '<li>(Nothing captured yet)</li>';
}


function sendJSONRPC() {
    // Send data to Kodi using the Beacon API (as XMLHttpRequest and fetch() can't
    // be used because of browser restrictions).
    // The beacon is a minimalistic HTTP POST request.

    // If you wish to use the Kodi JSON-RPC API, keep in mind that it demands the
    // Content-Type header of the request to be "application/json". The only way
    // to do this with a beacon is to use a Blob object, as per this answer:
    // https://stackoverflow.com/a/41729668
    //
    // Example of a beacon request to Kodi's JSON-RPC API to start playing
    // from your custom video plugin (so you need to call setResolvedUrl
    // back in your plugin Python code):
    /*
    const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'Player.Open',
        params: {
            item: {
                file: (
                    'plugin://plugin.video.myplugin/?'
                    + 'url=' + encodeURIComponent(this.dataset.url)
                    + '&mimeType=' + encodeURIComponent(this.dataset.mimeType)
                    + '&headerParams=' + encodeURIComponent(this.dataset.headerParams)
                )
            }
        }
    };
    const blob = new Blob([JSON.stringify(payload)], {type: 'application/json'});
    navigator.sendBeacon('http://'+HOST+':'+PORT+'/jsonrpc', blob);
    */

    // Instead, if using a simple socket server in Python in your video plugin instead of
    // Kodi's JSON-RPC API, the content can be sent as plain text with your own encoding,
    // or also encoding with JSON.stringify() for use with 'json.loads' back in Python.
    const payload = [
        'streamcatcher/0.1',
        this.dataset.url,
        this.dataset.mimeType,
        this.dataset.headerParams
    ].join('\n');

    const hostInput = document.getElementById('hostInput');
    const portInput = document.getElementById('portInput');
    const host = hostInput.value || hostInput.placeholder;
    const port = portInput.value || portInput.placeholder;
    const kodiURL = 'http://' + host + ':' + port + '/' + payload.length.toString();
    navigator.sendBeacon(kodiURL, payload);
    // Optional, close the popup window. However, don't do it immediately
    // or the beacon request might not be sent at all.
    //setTimeout(window.close, 700);
}


function onTextInputKeydown(event) {
    // The keycode 66 is supposedly for mobile Enter, from this page:
    // https://developer.android.com/reference/android/view/KeyEvent.html#KEYCODE_ENTER
    if (event.code == 'Enter' || event.code == 'NumpadEnter'
        || (event.keyCode && event.keyCode == 66)) {
        event.target.blur();
    }
}


// The popup HTML has been read fresh, so initialize everything.
function onRefresh(streamCatcher) {
    if (!streamCatcher) {
        return;
    }
    // Rebuild the <ul> list of requests, if there's any captured requests.
    const ul = document.getElementById('requests');
    if (Object.keys(streamCatcher.capturedRequests).length > 0) {
        ul.innerHTML = '';
        const capturedRequests = streamCatcher.capturedRequests;
        for (let urlKey in capturedRequests) {
            const request = capturedRequests[urlKey];
            // Create an <li> item to represent this captured request.
            const li = document.createElement('li');
            const formatMatch = request.url.match(FORMATS_PATTERN);
            let formatLabel;
            if (formatMatch) {
                formatLabel = formatMatch[1].toUpperCase();
            } else {
                formatLabel = request.mimeType == 'video/mp4' ? 'MP4' : 'M3U8';
            }
            li.innerHTML = '<b>' + formatLabel + ':</b> ' + request.url
            li.dataset.url          = request.url;
            li.dataset.headerParams = request.headerParams;
            li.dataset.mimeType     = request.mimeType;
            li.onclick = sendJSONRPC;
            ul.appendChild(li);
        }
    } else {
        clearRequestsList();
    }
    const settings = streamCatcher.settings;
    // Connect the inputs to handlers, and set their default/current values.
    // Set event handlers for the inputs.
    const hostInput = document.getElementById('hostInput');
    hostInput.value = settings.host;
    hostInput.placeholder = settings.host;
    hostInput.addEventListener('keydown', onTextInputKeydown);
    hostInput.addEventListener('change', (event) => {
        sendBackgroundMessage({type: 'set.settings', data: {host: event.target.value}});
    });
    const portInput = document.getElementById('portInput');
    portInput.value = settings.port;
    portInput.placeholder = settings.port;
    portInput.addEventListener('keydown', onTextInputKeydown);
    portInput.addEventListener('change', (event) => {
        sendBackgroundMessage({type: 'set.settings', data: {port: event.target.value}});
    });
    const blockingCheckbox = document.getElementById('blockingCheckbox');
    blockingCheckbox.checked = settings.useBlocking;
    blockingCheckbox.addEventListener('change', (event) => {
        sendBackgroundMessage({type: 'set.settings', data: {useBlocking: event.target.checked}});
    });
    const clearButton = document.getElementById('clearButton');
    clearButton.addEventListener('click', (event) => {
        // Clear the items from the <ul> and the captured requests.
        clearRequestsList();
        sendBackgroundMessage({type: 'clear.requests'});
    });
}

sendBackgroundMessage({type: 'get.everything'}, onRefresh);
