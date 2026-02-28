<?php
echo "<html><body><h1>Environment</h1><hr/><table>";
ksort($_SERVER);
foreach ($_SERVER as $k => $v) {
    echo "<tr><td>$k</td><td>$v</td></tr>";
}
echo "</table></body></html>";
?>