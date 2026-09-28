#!/usr/bin/env python3
"""List a GitHub repository's releases, newest first.

    releases.py cli/cli                  every published release
    releases.py cli/cli --latest         the latest stable release only
    releases.py cli/cli --limit 5 --assets

Set GITHUB_TOKEN to raise the rate limit from 60 requests an hour to 5,000.
"""

import argparse
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
from http.client import HTTPMessage
from typing import NamedTuple, Optional, TypedDict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

API = "https://api.github.com"


class AssetPayload(TypedDict):
    name: str


class ReleasePayload(TypedDict):
    tag_name: str
    name: Optional[str]
    draft: bool
    prerelease: bool
    published_at: Optional[str]
    assets: list[AssetPayload]


class PageResult(NamedTuple):
    items: list
    headers: HTTPMessage


@dataclass(frozen=True)
class RepositoryRef:
    owner: str
    name: str

    @classmethod
    def parse(cls, value: str) -> "RepositoryRef":
        owner, _, name = value.partition("/")
        return cls(owner=owner, name=name)

    def __str__(self) -> str:
        return f"{self.owner}/{self.name}" if self.name else self.owner


@dataclass(frozen=True)
class ApiToken:
    value: Optional[str]

    def __bool__(self) -> bool:
        return bool(self.value)

    def __repr__(self) -> str:
        return "ApiToken(***)" if self.value else "ApiToken(None)"


@dataclass(frozen=True)
class Release:
    tag: str
    name: str
    published: datetime
    prerelease: bool
    assets: list[str]


class GitHubReleases:
    def __init__(self, token: Optional[str] = None, timeout: int = 10) -> None:
        if token is not None and not isinstance(token, str):
            raise TypeError("token must be a string")
        if not isinstance(timeout, (int, float)):
            raise TypeError("timeout must be a number")
        self.token = ApiToken(token if token is not None else os.environ.get("GITHUB_TOKEN"))
        self.timeout = timeout

    def releases(self, repo: str, limit: Optional[int] = None) -> list[Release]:
        """Published releases of `owner/name`, reading only as many pages as `limit` needs."""
        if not isinstance(repo, str):
            raise TypeError("repo must be a string")
        if limit is not None and not isinstance(limit, int):
            raise TypeError("limit must be an integer")
        ref = RepositoryRef.parse(repo)
        url: Optional[str] = self._build_url(f"/repos/{ref}/releases?per_page=100")
        found: list[Release] = []
        while url and (limit is None or len(found) < limit):
            page = self._get(url)
            if page is None or page.items is None:
                break
            for item in page.items:
                if not isinstance(item, dict):
                    continue
                # Drafts only appear with push access, and have no publish date yet.
                if item["draft"]:
                    continue
                found.append(self._to_release(item))
            url = self._next_page(page.headers.get("Link", "") or "")
        return found[:limit]

    def latest(self, repo: str) -> Release:
        """The newest release that is neither a draft nor a prerelease."""
        if not isinstance(repo, str):
            raise TypeError("repo must be a string")
        ref = RepositoryRef.parse(repo)
        page = self._get(self._build_url(f"/repos/{ref}/releases/latest"))
        return self._to_release(page.items)

    def get_releases(self, repo: str, limit: Optional[int] = None) -> list[Release]:
        """Alias for :meth:`releases`."""
        return self.releases(repo, limit)

    def get_latest_release(self, repo: str) -> Release:
        """Alias for :meth:`latest`."""
        return self.latest(repo)

    def _build_url(self, path: str) -> str:
        return f"{API}{path}"

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token.value}"
        return headers

    def _get(self, url: str) -> PageResult:
        if not url:
            raise ValueError("url must not be empty")
        try:
            with urlopen(Request(url, headers=self._headers()), timeout=self.timeout) as response:
                return PageResult(items=self._parse_json(response), headers=response.headers)
        except HTTPError as error:
            logger.error("GitHub returned %s for %s", error.code, url)
            raise
        except URLError as error:
            logger.error("Could not reach GitHub: %s", error.reason)
            raise
        except json.JSONDecodeError:
            logger.error("GitHub returned invalid JSON for %s", url)
            raise

    def _parse_json(self, response):
        return json.load(response)

    def _to_release(self, item: ReleasePayload) -> Release:
        return _release(item)

    def _next_page(self, link_header: str) -> Optional[str]:
        return _next_page(link_header)


def _release(item: ReleasePayload) -> Release:
    if not isinstance(item, dict):
        raise TypeError("release payload must be a dict")
    return Release(
        tag=item["tag_name"],
        name=item["name"] or item["tag_name"],
        published=datetime.fromisoformat(item["published_at"]),
        prerelease=bool(item["prerelease"]),
        assets=[asset["name"] for asset in item["assets"] if isinstance(asset, dict)],
    )


def _next_page(link_header: str) -> Optional[str]:
    if not link_header:
        return None
    match = re.search(r'<([^>]+)>;\s*rel="next"', link_header)
    return match.group(1) if match else None


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="List a GitHub repository's releases.")
    parser.add_argument("repo", help="owner/name")
    parser.add_argument("--latest", action="store_true", help="only the latest stable release")
    parser.add_argument("--limit", type=int, help="at most this many releases")
    parser.add_argument("--assets", action="store_true", help="list each release's files too")
    args = parser.parse_args(argv)

    client = GitHubReleases()
    releases = [client.get_latest_release(args.repo)] if args.latest else client.get_releases(args.repo, args.limit)
    for release in releases:
        flag = "  (prerelease)" if release.prerelease else ""
        print(f"{release.published:%Y-%m-%d}  {release.tag:<16} {release.name}{flag}")
        if args.assets:
            for asset in release.assets:
                print(f"    {asset}")


if __name__ == "__main__":
    main()
