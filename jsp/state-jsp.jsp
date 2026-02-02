<%@ page contentType="text/html;charset=UTF-8" %>
<%
    String name = request.getParameter("userName");
    if (name != null && !name.isEmpty()) {
        session.setAttribute("savedName", name);
    }
    String displayName = (session.getAttribute("savedName") != null) ? 
                          (String)session.getAttribute("savedName") : "Guest";
%>
<html>
<body>
    <h1>JSP State Management</h1>
    <p>Current Name in Session: <strong><%= displayName %></strong></p>
    
    <form method="POST">
        New Name: <input type="text" name="userName">
        <input type="submit" value="Update">
        <input type="button" value="Clear" onclick="window.location.href='?clear=true'">
    </form>

    <% if(request.getParameter("clear") != null) { session.invalidate(); response.sendRedirect("state-jsp.jsp"); } %>
</body>
</html>