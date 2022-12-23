# Example of a Python script for a Kodi video plugin showing how to temporarily listen
# to the StreamCatcher extension requests.
# Once you grab the request details, the server stops as it's not needed anymore, and
# Kodi can be asked to play the stream that the request was meant to get.

# NOTE 1: this code is just an example. Integrate it with your add-on(s) in your own way.

# NOTE 2: this code is for Python 2.x. Some things will have to be renamed if you're using Python 3.x.

import socket
import threading
from time import sleep
from urllib import quote_plus

import requests

import xbmc
import xbmcgui
import xbmcplugin
from xbmcaddon import Addon


ADDON = Addon()

PLUGIN_ID = int(sys.argv[1])
PLUGIN_URL = sys.argv[0]

LISTITEM = xbmcgui.ListItem


def playStreamCatcher():
    # Use the user-written IP address, or try the local IP of the device.
    if ADDON.getSetting('streamcatcher.useCustomHost') == 'true':
        host = ADDON.getSetting('streamcatcher.customHost')
    else:
        host = socket.gethostbyname(socket.gethostname())
    tempPort = ADDON.getSetting('streamcatcher.port')
    port = int(tempPort) if tempPort.isdigit() else 8080

    outputDict = {'data': None, 'message': None}
    stopEvent = threading.Event()

    # Handle the connection in a separate thread.
    serverThread = threading.Thread(target=streamCatcherServer, args=(host, port, outputDict, stopEvent))
    serverThread.start()

    # Wait for 90 seconds. Since each step sleeps for 500ms, the total steps are 90 x 2.
    MAX_STEPS = 90 * 2
    remainingSteps = MAX_STEPS
    tempMonitor = xbmc.Monitor()
    message = 'Serving on: http://%s:%i' % (host, port)
    progressDialog = xbmcgui.DialogProgress()
    progressDialog.create('Waiting for StreamCatcher...', message)
    while True:
        minutesLeft = (remainingSteps // 2) / 60.0
        timeMessage = '%02i:%02i' % (minutesLeft, (minutesLeft-int(minutesLeft))*60.0)
        progressDialog.update(100 - int(remainingSteps * 100.0 / MAX_STEPS), message, timeMessage)
        if (
            remainingSteps < 1
            or tempMonitor.abortRequested()
            or progressDialog.iscanceled()
            or not serverThread.isAlive()
        ):
            stopEvent.set()
            break
        xbmc.sleep(500)
        remainingSteps = remainingSteps - 1
    progressDialog.close()

    try:
        serverThread.join(5.0)
    except:
        pass

    if outputDict:
        if outputDict['data']:
            version, url, mimeType, headerParams = outputData.split('\n')
            headers = dict(parse_qsl(headerParams))
            # Debug:
            #xbmcLog('StreamCatcher >> prepareStreamData:', '>'+outputData+'<')
            if version.startswith('streamcatcher/'):
                # Clean up the incoming headers.
                if (ADDON.getSetting('streamcatcher.removeBR') == 'true'):
                    # Remove the Brötli "br" encoding, if asked for.
                    if 'Accept-Encoding' in headers:
                        headers['Accept-Encoding'] = 'gzip, deflate'
                    elif 'accept-encoding' in headers:
                        headers['accept-encoding'] = 'gzip, deflate'
                headers.pop('TE', None)
                headers.pop('Host', None)
                headers.pop('Range', None) # Very important to delete this, so Kodi's FFMpeg inserts its own.
                headers.pop('Cookie', None)

                session = requests.Session()
                session.headers.update(headers)

                kodiURL = encodeKodiHeaders(url, session.headers)
                item = LISTITEM('StreamCatcher', path=kodiURL)
                item.setInfo('video', {'mediatype': 'video'})
                item.setProperty('IsPlayable', 'true')
                item.setMimeType(mimeType)
                item.setContentLookup(False)
                return xbmcplugin.setResolvedUrl(PLUGIN_ID, True, item)
            else:
                return showInfo('StreamCatcher: unexpected browser extension payload')
        elif outputDict['message']:
            showInfo(outputDict['message'])
    return xbmcplugin.setResolvedUrl(PLUGIN_ID, False   , LISTITEM())


# Add HTTP headers for Kodi to use when it asks FFMpeg to play the media.
# Read more in these links:
# https://kodi.wiki/view/HTTP
# https://github.com/xbmc/xbmc/blob/Matrix/xbmc/filesystem/CurlFile.cpp#L844-L929
def encodeKodiHeaders(url, headers):
    return url + '|' + '&'.join(key + '=' + quote_plus(headers[key]) for key in headers)


# Log a LOGNOTICE-level message.
def xbmcLog(*args):
    xbmc.log('StreamCatcher Log > ' + ' '.join((var if isinstance(var, str) else repr(var))
                                                for var in args), xbmc.LOGNOTICE)


# Creates a non-blocking HTTP socket server with a timeout (a polling
# frequency) of 1 second.
# It waits for an HTTP POST request to arrive, reads the data from it
# and closes the connection, then stops serving.
#
# Args:
#   host: the string host address to use with the server socket.
#   Examples: '192.168.0.15', 'localhost' etc.
#
#   port: the *integer* port number. Example: 8080.
#
#   outputDict: a dict or dict-like object where the output data will be
#   stored so that this function can be used in a thread.
#   The dict will have these keys:
#       "data": string with the POST body, or None.
#       "message": string with information about an error, or None.
#
#   stopEvent: a thread.Event exclusively for enabling this server.
#   This event can be set externally so the server stops, as a means to
#   cancel it. This function might set the event itself to signal that
#   it has stopped.
def streamCatcherServer(host, port, outputDict, stopEvent):
    outputDict['data']    = None
    outputDict['message'] = None
    connection = None

    # Start the server socket.
    try:
        serverSocket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        serverSocket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        serverSocket.settimeout(1.0)
        serverSocket.bind((host, port))
        serverSocket.listen(1)
    except Exception as e:
        outputDict['message'] = (
            '%s | Unable to serve on IP "%s" and port %i' % (str(e), host, port)
        )
        stopEvent.set()
        return

    # Try to get a connection.
    while not stopEvent.is_set():
        try:
            connection, clientAddress = serverSocket.accept()
            break
        except socket.timeout:
            # Server socket timed out, keep trying.
            connection = None
        except Exception as e:
            # Unknown error, cancel everything.
            stopEvent.set()
            outputDict['message'] = '%s | Error with socket.accept()' % str(e)

    # Close the server socket as it's not needed anymore.
    try:
        serverSocket.close()
    except:
        pass

    # Only continue if we have a connection to use.
    if not connection:
        if not outputDict['message']:
            outputDict['message'] = 'No connection established'
        return

    # Try to read an HTTP POST from the connection.
    HTTP_BODY_SEPARATOR = b'\r\n\r\n'
    contentLength = None
    chunks = []
    while not stopEvent.is_set():
        try:
            data = connection.recv(4096)
            if data:
                chunks.append(data)
                if contentLength != None:
                    # Reading body.
                    # The exit condition is at the end of this while loop, when the
                    # content length is all consumed.
                    contentLength -= len(data)
                else:
                    # Reading headers.
                    # Look for the HTTP body separator pattern to consider the
                    # headers as completed.
                    if HTTP_BODY_SEPARATOR in data:
                        headers, partialBody = ''.join(chunks).split(HTTP_BODY_SEPARATOR, 1)
                        if b'POST /' in headers and b' HTTP/' in headers:
                            strContentLength = headers.split(' /', 1)[1].split(' HTTP/', 1)[0]
                            # Note that the full body, or part of it, might also be included
                            # in the (partial) data we've received so far. Try to read it now.
                            if strContentLength and strContentLength.isdigit():
                                del chunks[:]
                                chunks.append(partialBody)
                                contentLength = int(strContentLength) - len(partialBody)
                            else:
                                outputDict['message'] = 'Expected "/[length]" in the URL path'
                                stopEvent.set()
                                break
                        else:
                            outputDict['message'] = 'Expected an HTTP POST request'
                            stopEvent.set()
                            break
            else:
                # Zero data came through, so the client is finished sending data.
                stopEvent.set()
                break
        except:
            pass
        # Exit condition for when reading the body. This must be at the end of this
        # loop as the body might come along with all headers in a single data chunk.
        if contentLength != None and contentLength <= 0:
            stopEvent.set()
            break
        else:
            sleep(0.2)

    # Send a response, for safety, and prepare the output.
    if contentLength != None:
        responseStatus = '200 OK'
        outputDict['data'] = ''.join(chunks)
    else:
        responseStatus = '403 Forbidden'
    fullResponse = (
        b'HTTP/1.1 %s\r\n'
        b'Connection: close\r\n'
        b'\r\n'
    ) % responseStatus
    try:
        connection.sendall(fullResponse)
    except:
        pass
    try:
        connection.shutdown(socket.SHUT_RDWR)
        connection.close()
    except:
        pass
