#!/usr/bin/env python3
"""List a GitHub repository's releases, newest first.

    releases.py cli/cli                  every published release
    releases.py cli/cli --latest         the latest stable release only
    releases.py cli/cli --limit 5 --assets

Set GITHUB_TOKEN to raise the rate limit from 60 requests an hour to 5,000.
"""

import argparse
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from urllib.request import Request, urlopen

API = "https://api.github.com"


@dataclass(frozen=True)
class Release:
    tag: str
    name: str
    published: datetime
    prerelease: bool
    assets: list[str]


class GitHubReleases:
    def __init__(self, token=None, timeout=10):
        self.token = token if token is not None else os.environ.get("GITHUB_TOKEN")
        self.timeout = timeout

    def releases(self, repo, limit=None):
        """Published releases of `owner/name`, reading only as many pages as `limit` needs."""
        url = f"{API}/repos/{repo}/releases?per_page=100"
        found = []
        while url and (limit is None or len(found) < limit):
            page, headers = self._get(url)
            # Drafts only appear with push access, and have no publish date yet.
            found += [_release(item) for item in page if not item["draft"]]
            url = _next_page(headers.get("Link", ""))
        return found[:limit]

    def latest(self, repo):
        """The newest release that is neither a draft nor a prerelease."""
        item, _ = self._get(f"{API}/repos/{repo}/releases/latest")
        return _release(item)

    def _get(self, url):
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        with urlopen(Request(url, headers=headers), timeout=self.timeout) as response:
            return json.load(response), response.headers


def _release(item):
    return Release(
        tag=item["tag_name"],
        name=item["name"] or item["tag_name"],
        published=datetime.fromisoformat(item["published_at"]),
        prerelease=item["prerelease"],
        assets=[asset["name"] for asset in item["assets"]],
    )


def _next_page(link_header):
    match = re.search(r'<([^>]+)>;\s*rel="next"', link_header)
    return match.group(1) if match else None


def main(argv=None):
    parser = argparse.ArgumentParser(description="List a GitHub repository's releases.")
    parser.add_argument("repo", help="owner/name")
    parser.add_argument("--latest", action="store_true", help="only the latest stable release")
    parser.add_argument("--limit", type=int, help="at most this many releases")
    parser.add_argument("--assets", action="store_true", help="list each release's files too")
    args = parser.parse_args(argv)

    client = GitHubReleases()
    releases = [client.latest(args.repo)] if args.latest else client.releases(args.repo, args.limit)
    for release in releases:
        flag = "  (prerelease)" if release.prerelease else ""
        print(f"{release.published:%Y-%m-%d}  {release.tag:<16} {release.name}{flag}")
        if args.assets:
            for asset in release.assets:
                print(f"    {asset}")


if __name__ == "__main__":
    main()
