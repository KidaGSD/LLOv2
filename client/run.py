#!/usr/bin/env python3
import http.server
import socketserver
import os
import webbrowser
import socket

# Try ports starting from 8080 up to 8090
START_PORT = 8080
MAX_PORT = 8090
DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

if __name__ == "__main__":
    print(f"Serving files from: {DIRECTORY}")
    # Try different ports
    for port in range(START_PORT, MAX_PORT + 1):
        try:
            with socketserver.TCPServer(("", port), Handler) as httpd:
                print(f"Server running at http://localhost:{port}/client/")
                webbrowser.open(f'http://localhost:{port}/client/')
                httpd.serve_forever()
                break  # If server starts successfully, exit the loop
        except OSError as e:
            if e.errno == 48:  # Address already in use
                print(f"Port {port} is already in use, trying next port...")
            else:
                raise
    else:
        print(f"All ports from {START_PORT} to {MAX_PORT} are in use. Please free up a port and try again.") 