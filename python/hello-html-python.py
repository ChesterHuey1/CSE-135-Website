#!/usr/bin/env python3
import time
import os

curTime = time.strftime("%a %b %d %H:%M:%S %Y")
address = os.environ.get('REMOTE_ADDR', 'Unknown')

print("Content-type: text/html\n")

print("<html>")
print("<head>")
print("<title>Hello CGI World</title>")
print("</head>")
print("<body>")

print("<h1 align='center'>Hello HTML World</h1>")
print("<hr/>")

print("<p>Hello World</p>")
print("<p>This page was generated with the Python programming language</p>")
print(f"<p>This program was generated at: {curTime}</p>")
print(f"<p>Your current IP Address is: {address}</p>")

print("</body>")
print("</html>")