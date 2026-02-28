<%@ page contentType="text/html;charset=UTF-8" %>
<%@ page import="java.io.*" %>
<%
    String ip = request.getHeader("X-Forwarded-For");
    if (ip == null || ip.isEmpty()) { ip = request.getRemoteAddr(); }
    
    StringBuilder sb = new StringBuilder();
    BufferedReader reader = request.getReader();
    String line;
    while ((line = reader.readLine()) != null) { sb.append(line); }
%>
<html>
<body>
    <h1>JSP Echo Response</h1>
    <p><b>Real IP:</b> <%= ip %></p>
    <p><b>Method:</b> <%= request.getMethod() %></p>
    <hr/>
    <pre><%= sb.toString() %></pre>
</body>
</html>
