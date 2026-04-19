Subject: PAiA security advisory — please update to {{fixed_version}}

Hi {{first_name}},

This is a security advisory for every PAiA user. Please take a minute
to read it carefully — you're getting this because you have an active
license on file.

## What happened

{{one_paragraph_description_of_the_issue_in_plain_language}}

## Severity

{{Low / Medium / High / Critical}}. {{one_line_impact_summary}}

## Who's affected

{{who: all users / users on vX.Y.Z and earlier / users who enabled
feature X}}

## What you need to do

1. **Update to PAiA {{fixed_version}} or later.** Open the app;
   Settings → About → Check for updates will prompt you. Or download
   from https://paia.app/download.html

2. {{feature-specific action — e.g., regenerate your API server token,
   re-issue any affected license, rotate passwords on connected
   services}}

3. If you've been running PAiA unpatched in a high-trust environment
   (classroom, shared workstation, etc.), review
   {{userData_path}}/logs for unexpected agent runs between
   {{start_date}} and now.

## Timeline

- {{when_discovered}} — issue discovered and triaged.
- {{when_acknowledged}} — reproduction confirmed; fix work started.
- {{when_fixed}} — patch shipped as {{fixed_version}}.
- {{when_disclosed}} — this advisory + public write-up published at
  https://paia.app/security.html

## Credit

{{Thanks to the researcher who reported this — name or handle per
their preference; or "Discovered internally during routine review."}}

## Questions

Reply to this email, or reach us at security@paia.app. PGP available
at https://paia.app/pgp.asc.

We're sorry this happened and grateful you're putting up with the
inconvenience.

— Sam
{{support_email}}
