# History cleanup: November 2026

Threadlight's published branch histories were rewritten on 4 November 2026 to
remove personal author email, native chat identifiers, personal workstation paths
and local screenshots/build output that had previously entered Git history.
The repository licence and public author attribution are unchanged.

## If you cloned before the cleanup

Preserve uncommitted work and private local files outside the old clone, then clone
the repository again. Reapply only the source changes you need and review them for
personal information. Do not merge an old branch or push old tags/commits back into
the cleaned repository: that can restore the removed history.

Do not delete your only copy of unfinished work to get a clean Git status. If you
have a substantial branch to preserve, arrange a deliberate rebase or patch transfer
onto the cleaned history instead of an ordinary merge.

New commits should use your chosen public or GitHub noreply email. Keep credentials,
local screenshots, application data and generated builds out of the source history.
Use synthetic examples in tests, demonstrations and validation records.

## Scope and limits

The rewrite preserves the source and commit relationships except for the explicitly
removed local artifacts and sanitised examples/metadata. It does not revoke provider
credentials or change how Threadlight accesses accounts. No exposed credential was
identified in the final cleaned-history secret scan.

Changing branches cannot erase copies held by others. GitHub may also retain old
commits in cached views and read-only pull-request references; those need a separate
Support review and server-side purge. Until that is confirmed, do not describe the
cleanup as complete erasure from GitHub.

See [GitHub's sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
