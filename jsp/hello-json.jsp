<%@ page contentType="application/json;charset=UTF-8" %>
<%@ page import="java.util.Date" %>
<%
    String ip = request.getHeader("X-Forwarded-For");
    if (ip == null || ip.isEmpty()) { ip = request.getRemoteAddr(); }
%>
{
    "language": "JSP",
    "ipAddress": "<%= ip %>",
    "serverTime": "<%= new Date() %>"
}