<?php
header("Content-Type: application/json");
echo json_encode([
    "message" => "Hello World",
    "time" => date("c"),
    "ip" => $_SERVER['REMOTE_ADDR']
]);
?>