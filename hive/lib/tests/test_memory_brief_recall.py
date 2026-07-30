"""Tests for the PAN-6642 semantic-recall source in hive/lib/memory_brief.py.

Covers the story-agent pre-task memory hook: the prior-experience brief now
adds a '### Recalled Knowledge (semantic corpus)' section sourced from the
swarm-memory Qdrant corpus, keyed on the story text (--query).
"""

from __future__ import annotations

from hive.lib import memory_brief
from hive.lib.memory_brief import (
    RECALL_SECTION,
    build_prior_experience,
    gather_semantic_recall,
)


def test_recall_section_omitted_when_no_query(tmp_path, monkeypatch):
    # If recall were consulted it would raise; asserting it is not called.
    monkeypatch.setattr(
        memory_brief, "gather_semantic_recall",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not run")),
    )
    section = build_prior_experience(
        "developer", None, None,
        team_memories_root=tmp_path, classic_memories_root=tmp_path,
        kg_db_path=tmp_path / "absent.sqlite",
    )
    assert RECALL_SECTION not in section


def test_recall_section_rendered_from_hits(tmp_path, monkeypatch):
    monkeypatch.setattr(
        memory_brief, "gather_semantic_recall",
        lambda query, **k: [("att-site/pricing.md", "anchor rate is $250/hr")],
    )
    section = build_prior_experience(
        "developer", None, None,
        query="ATT pricing strategy",
        team_memories_root=tmp_path, classic_memories_root=tmp_path,
        kg_db_path=tmp_path / "absent.sqlite",
    )
    assert RECALL_SECTION in section
    assert "att-site/pricing.md" in section
    assert "anchor rate is $250/hr" in section


def test_recall_respects_token_budget(tmp_path, monkeypatch):
    # A tiny budget leaves no room for the recall section.
    monkeypatch.setattr(
        memory_brief, "gather_semantic_recall",
        lambda query, **k: [("x.md", "y" * 500)],
    )
    section = build_prior_experience(
        "developer", None, None,
        query="q", token_budget=5,
        team_memories_root=tmp_path, classic_memories_root=tmp_path,
        kg_db_path=tmp_path / "absent.sqlite",
    )
    assert RECALL_SECTION not in section


def test_gather_semantic_recall_empty_query_returns_empty():
    assert gather_semantic_recall("") == []
    assert gather_semantic_recall("   ") == []


def test_gather_semantic_recall_missing_cli_is_safe():
    # A non-existent binary must degrade to [] rather than raising.
    assert gather_semantic_recall("real query", bin_path="/nonexistent/swarm-memory-xyz") == []
