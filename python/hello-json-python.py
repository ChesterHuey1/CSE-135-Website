#!/usr/bin/env python3
import json
import time
import os

# Set headers
print("Cache-Control: no-cache")
print("Content-type: application/json\n")

curTime = time.strftime("%a %b %d %H:%M:%S %Y")
address = os.environ.get('REMOTE_ADDR', 'Unknown')

message = {
    'title': 'Hello, Python!',
    'heading': 'Hello, Python!',
    'message': 'This page was generated with the Python programming language',
    'time': curTime,
    'IP': address
}

print(json.dumps(message))