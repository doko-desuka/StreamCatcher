// DEBUGGING: to see any console.log() or console.dir() output, you need to go to the extension
// debugging windonw. On Firefox, go to "about:debugging#/runtime/this-firefox" and click the Inspect
// button, inside the info box for this extension (the extension needs to be loaded of course).
// Any calls you make to console.log() or console.dir() will not go to the DevTools console, but
// that console in the inspection window.
// Uncomment the console.log() and console.dir() calls to see relevant debug messages.

// Relevant projects:
// - https://github.com/puemos/hls-downloader
// - https://github.com/Nitrama/HTTP-Header-Live

'use strict';


import { isChrome } from './utils.js';


// Session storage.
// These are reset each time the browser is closed, or the extension is disabled.
// In private/incognito tabs these are only visible to this script, so other scripts use
// messaging to request access to them.
window.streamCatcher = {
    // Captured requests dictionary, keyed by URL so you can tell if a URL is already captured.
    capturedRequests: {},
    // Settings for the extension.
    settings: {
        // Default values for the host and port that Kodi is supposedly listening to.
        // When an item is clicked on the <ul> in popup.html, a request will be sent
        // to this address.
        host: '192.168.0.13', // <-- CHANGE this, use your Kodi device's static local IP.
        port: '8080',
        useBlocking: true
    }
};

const CANCEL_REQUEST = {cancel: true};


function clearCapturedRequests() {
    for (let urlKey in window.streamCatcher.capturedRequests) {
        delete window.streamCatcher.capturedRequests[urlKey];
    }
    // Reset the text of the little notification badge.
    chrome.browserAction.setBadgeText({text: null});
}


function isRangeHeader(header) {
    return (header.name == 'Range' || header.name == 'range');
}


// Called on outgoing requests. Estimates their MIME-type based on the URL string and headers.
// Returns either a string with the MIME-type (eg. "video/mp4" or "application/x-mpegURL") or
// returns null if it could not be estimated or isn't considered a media item.
function detectMIMEType(details) {
    const lowerURL = details.url.toLowerCase();
    if (details.type == 'xmlhttprequest') {
        // The request is being sent either by the XMLHttpRequest or Fetch APIs.
        // Note: this "hls" pattern was added because of the HQQ hoster, the only
        // way of knowing if it's the playlist request or not.
        if (lowerURL.includes('m3u8') || lowerURL.includes('hls')) {
            return 'application/x-mpegURL';
        }
    } else {
        if (lowerURL.includes('mp4') || details.requestHeaders.some(isRangeHeader)) {
            return 'video/mp4';
        }
    }
    return null;
}


function isStreamContentType(lowercaseText) {
    return (lowercaseText.includes('video/') || lowercaseText.includes('application/x-mpegurl')
            || lowercaseText.includes('vnd.apple.mpegurl'));
}


function isAlreadyCaptured(targetURL) {
    return (targetURL in window.streamCatcher.capturedRequests);
}


function blockIfNeeded() {
    if (window.streamCatcher.settings.useBlocking) {
        return CANCEL_REQUEST;
    } else {
        return undefined;
    }
}


function catchStream(details, mimeType, isResponse) {
    // Client request headers to send to Kodi.
    const relevantHeaders = {};
    if (isResponse) {
        // TODO
        // Coming in from the responses listener.
        // See if there's any "unidentified" requests that were captured and have
        // the same requestId (see the commented out "onHeadersReceived" listener
        // for more info on this.)
        /*
        if (details.requestId in mysteriousRequests) {
            const originalRequest = mysteriousRequests[details.requestId];
            relevantHeaders = originalRequest.headers;
            originalURL     = originalRequest.url;
            // (...)
        } else {
            return;
        }
        */
    } else {
        // Coming in from the requests listener.
        // Copy all requests, let the Kodi side worry about which ones are useful or not.
        for (let i = 0; i < details.requestHeaders.length; ++i) {
            relevantHeaders[details.requestHeaders[i].name] = details.requestHeaders[i].value;
        }
    }
    // Create the capture info object and store it in the background window memory storage.
    const newCapture = {
        url: details.url,
        mimeType: mimeType,
        headerParams: (new URLSearchParams(relevantHeaders)).toString(),
    }
    window.streamCatcher.capturedRequests[details.url] = newCapture;
    const totalCaptures = Object.keys(window.streamCatcher.capturedRequests).length;
    chrome.browserAction.setBadgeText({text: totalCaptures.toString()});

    // Debug:
    //console.log('catchStream:', details.url, mimeType, details);

    // Always return a BlockingResponse to cancel the browser request/response.
    return blockIfNeeded();
}

// TODO: support matching a response with the request that caused it, using
// 'details.requestId' (see more here: https://mzl.la/3BFrm7q).
// Some websites use API requests that redirect to the media location, and
// those requests don't have a ".mp4" or other identifiable string in the URL
// but something weird like "website.com/api/episode/23f82c0a2", so the
// onBeforeSendHeaders listener doesn't know that the request should be captured.
//
// When the response arrives later on with a streamable Content-Type header (like
// "video/mp4" etc), we'd need to have the **exact same** request headers that
// caused that response, or else when Kodi tries to play that URL, the server will
// refuse with a 403 forbidden because the header signature doesn't match to the
// original browser request that caused it.
// To fix this, for every "weird" URL request that's not captured and that isn't
// for some normal web asset (.js, .css, .jpg etc.), keep a copy of the headers
// and the request ID, so that if some streamable content is revealed in a
// response, we can copy the headers from the corresponding request w/ that ID.
// Since this is rare (most websites make requests for the direct media), I
// didn't bother going forward with this.
/*
// A listener for incoming responses.
// Allow blocking responses if needed, and have response HTTP headers
// in the details object.
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        // Don't repeat captured requests.
        if (isAlreadyCaptured(details.url)) {
            console.log('onHeadersReceived >> repeated request:', details.url);
            return blockIfNeeded();
        }
        for (let i = 0; i < details.responseHeaders.length; ++i) {
            // Check the header key and value as **lowercase** for safety.
            if (details.responseHeaders[i].name.toLowerCase() == 'content-type') {
                // If the response is for video content then capture it.
                if (isStreamContentType(details.responseHeaders[i].value.toLowerCase())) {
                    return catchStream(details, true);
                } else {
                    // This isn't video content, let the response pass through.
                    return;
                }
            }
        }
    },
    {urls: ["<all_urls>"]}, ["blocking", "responseHeaders"]
);
*/


// A listener for outgoing requests.
// Allow this listener to block the request if needed, and have HTTP headers present in the
// 'details' argument.
// The "extraHeaders" flag is for Chrome only, explained in here: https://stackoverflow.com/a/59589723
function onBeforeSendHeaders(details) {
    // All media / playlist requests are GETs.
    // TODO: support POSTs too? What if the video hoster returns the .m3u8 playlist
    // after a POST request? It wouldn't get detected as it is.
    /*if (details.method != 'GET') {
        return;
    }*/

    // Block repeated requests if the stream was already captured.
    // Some JavaScript players try to send repeated attempts on failure.
    if (isAlreadyCaptured(details.url)) {
        // Debug:
        //console.log('onBeforeSendHeaders >> repeated request:', details.url);
        return blockIfNeeded();
    }
    // If this request passes some media tests, it's probably something we should
    // capture.
    const mediaMIMEType = detectMIMEType(details);
    if (mediaMIMEType) {
        return catchStream(details, mediaMIMEType, false);
    }
    // Debug uncaptured requests, as the function didn't reach the catchStream() call above:
    //console.log(details);
}
const extraInfoSpec = (isChrome()) ?
    ["blocking", "requestHeaders", "extraHeaders"]
    : ["blocking", "requestHeaders"];
chrome.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeaders,
    {types: ['media', 'xmlhttprequest'], urls: ['<all_urls>']}, extraInfoSpec
);


// A listener for "browser tab updates".
// If the tab update concerns its URL, then clear all captured requests to start fresh.
// This URL change happens when a tab is either reloaded, or when the user visits a link
// by clicking on something or manually typing it in.
function onTabUpdate(tabID, changeInfo) {
    // This '.url' key is only present if it's a URL update.
    // Don't clear the list if the URL change is coming from non-websites.
    if (changeInfo.url
        && !changeInfo.url.includes('extension://')
        && !changeInfo.url.includes('chrome://')
        && !changeInfo.url.includes('about:blank')) {
        clearCapturedRequests();
    }
}
if (isChrome()) {
    chrome.tabs.onUpdated.addListener(onTabUpdate);
} else {
    // Firefox only. Monitor just the status of the tab to reduce redundant calls.
    chrome.tabs.onUpdated.addListener(onTabUpdate, {properties:['status']});
}

// Set a message listener so that external scripts (like popup.js) can ask this script for
// its session data.
// This is the only way to support this extension working on private/incognito tabs, because
// the 'chrome.extension.getBackgroundPage()' function that can be used to access the
// environment of this background script will NOT work on private tabs, only normal tabs.
function onMessage(request, sender, sendResponse) {
    if (request.type == 'get.everything') {
        if (isChrome()) {
            sendResponse(window.streamCatcher);
            return;
        } else {
            return Promise.resolve(window.streamCatcher);
        }
    } else if (request.type == 'clear.requests') {
        clearCapturedRequests();
    } else if (request.type == 'set.settings') {
        if (request.data) {
            Object.keys(request.data).forEach(
                (key) => {
                    if (key in window.streamCatcher.settings) {
                        window.streamCatcher.settings[key] = request.data[key];
                    }
                }
            );
        }
    }
}
chrome.runtime.onMessage.addListener(onMessage);

// Set the default background and text colors of the little notification badge.
chrome.browserAction.setBadgeBackgroundColor({color:'#ffff00'});
if (!isChrome()) {
    // Setting the badge text color only works on Firefox.
    chrome.browserAction.setBadgeTextColor({color:'#000000'});
}
