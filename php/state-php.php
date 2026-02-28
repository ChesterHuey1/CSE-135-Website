<?php
$u = $_POST['new_u'] ?? $_POST['u'] ?? 'Guest';
echo "<html><body><h1>State</h1><hr/>";
echo "<p>Current: <b>$u</b></p>";
echo "<form method='POST'>";
echo "<input type='hidden' name='u' value='$u'>";
echo "New: <input type='text' name='new_u'>";
echo "<button type='submit'>Update</button></form>";
echo "<form method='POST'>";
echo "<input type='hidden' name='u' value='Guest'>";
echo "<button type='submit'>Clear</button></form>";
echo "</body></html>";
?>