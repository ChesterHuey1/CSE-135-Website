#!/usr/bin/perl
print "Cache-Control: no-cache\n";
print "Content-type: text/html \n\n";

# print HTML file top
print <<END;
<!DOCTYPE html>
<html><head><title>Environment Variables</title>
</head><body><h1 align="center">Environment Variables</h1>
<hr>
END

# Loop over the environment variables and print each variable and its value
foreach $variable (sort keys %ENV) {
  print "<b>$variable:</b> $ENV{$variable}<br />\n";
}

# Print the HTML file bottom
print "</body></html>";
#!/usr/bin/perl
use CGI;

# Create a new Perl Session
use CGI::Session;
$session = new CGI::Session("driver:File", undef, {Directory=>"/tmp"});

# Create CGI Object
$cgi = CGI->new;

# Create a new Cookie from the Session ID
$cookie = $cgi->cookie(CGISESSID => $session->id);
print $cgi->header( -cookie=>$cookie );

#Store Data in that Perl Session
my $name = $session->param('username') || $cgi->param('username');
$session->param("username", $name);

print "<html>";
print "<head>";
print "<title>Perl Sessions</title>";
print "</head>";
print "<body>";

print "<h1>Perl Sessions Page 1</h1>";

if ($name){
	print("<p><b>Name:</b> $name");
}else{
	print "<p><b>Name:</b> You do not have a name set</p>";
}
print "<br/><br/>";
print "<a href=\"/cgi-bin/perl-sessions-2.pl\">Session Page 2</a><br/>";
print "<a href=\"/perl-cgiform.html\">Perl CGI Form</a><br />";
print "<form style=\"margin-top:30px\" action=\"/cgi-bin/perl-destroy-session.pl\" method=\"get\">";
print "<button type=\"submit\">Destroy Session</button>";
print "</form>";

print "</body>";
print "</html>";
