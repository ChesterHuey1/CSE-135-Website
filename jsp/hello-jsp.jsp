<%@ page contentType="text/html;charset=UTF-8" %>
<%@ page import="java.util.Date" %>
<%
    String format = request.getParameter("format");
    if ("json".equals(format)) {
        response.setContentType("application/json");
        out.print("{\"message\": \"Hello from JSP\", \"time\": \"" + new Date() + "\"}");
    } else {
%>
<html>
<body>
    <h1>Hello from JSP (Java)</h1>
    <hr/>
    <p>Server Time: <%= new Date() %></p>
    <p>Your IP: <%= request.getRemoteAddr() %></p>
</body>
</html>
<% } %>