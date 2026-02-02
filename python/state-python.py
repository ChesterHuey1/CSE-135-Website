#!/usr/bin/env python3
import cgi
import os

form = cgi.FieldStorage()

user = form.getfirst('new_username') or form.getfirst('username') or 'Guest'
print("Content-type: text/html\n")
print("<html><body>")
print("<h1 align='center'>Python State Management</h1><hr/>")
print(f"<p>Current Name: <b>{user}</b></p>")
print('<form action="state-python.py" method="POST">')
print(f'    <input type="hidden" name="username" value="{user}">')
print('    New Name: <input type="text" name="new_username">')
print('    <button type="submit">Update</button>')
print('</form>')

print('<form action="state-python.py" method="POST">')
print('    <input type="hidden" name="username" value="Guest">')
print('    <button type="submit">Clear</button>')
print('</form>')

print("</body></html>")