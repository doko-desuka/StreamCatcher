'use strict';


const FORMATS_PATTERN = /\.(mp4|m3u8|webm|ogg|ogv|3gp)/i;


function isChrome() {
    return (navigator.vendor.includes('Google'));
}


export { FORMATS_PATTERN, isChrome };