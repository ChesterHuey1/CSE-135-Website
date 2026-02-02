#!/usr/bin/env python3
import os

print("Cache-Control: no-cache")
print("Content-type: text/html\n")
print("<html>")
print("<head>")
print("<title>Python Environment Variables</title>")
print("</head>")
print("<body>")
print("<h1 align='center'>Python Environment Variables</h1>")
print("<hr/>")

for variable in sorted(os.environ.keys()):
    print(f"{variable}:{os.environ[variable]}<br/>")

print("</body>")
print("</html>")