#!/usr/bin/env python3
import os, sys, time, socket

print("Content-type: text/html\n")
print("<html><body>")
print("<h1>Echo Response</h1><hr/>")

print(f"<p><b>Hostname: {socket.gethostname()}</p>")
print(f"<p><b>Date/Time: {time.strftime('%a %b %d %H:%M:%S %Y')}</p>")
print(f"<p><b>IP Address: {os.environ.get('REMOTE_ADDR')}</p>")
print(f"<p><User Agent: {os.environ.get('HTTP_USER_AGENT')}</p>")
print(f"<p>Method: {os.environ.get('REQUEST_METHOD')}</p>")
print("<hr/><h3>Raw Data:</h3>")

if os.environ.get('REQUEST_METHOD') == 'GET':
    print(f"<pre>{os.environ.get('QUERY_STRING')}</pre>")
else:
    length = int(os.environ.get('CONTENT_LENGTH', 0))
    print(f"<pre>{sys.stdin.read(length)}</pre>")

print("</body></html>")