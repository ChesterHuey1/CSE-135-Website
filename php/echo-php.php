<?php
$m = $_SERVER['REQUEST_METHOD'];
echo "<h1>Echo Response</h1><hr/>";
echo "<p>Method: $m</p>";
echo "<pre>Data: ";
if ($m === 'GET') {
    echo $_SERVER['QUERY_STRING'];
} else {
    echo file_get_contents('php://input');
}
echo "</pre>";
?>