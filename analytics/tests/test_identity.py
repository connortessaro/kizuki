from kizuki_analytics.identity import (
    RawIdentity,
    github_login,
    identity_hash,
    is_bot,
    normalize_email,
    resolve,
)


def ident(email, name, n=1, repos=("kizuki",)):
    return RawIdentity(email=email, name=name, commit_count=n, repos=repos)


def test_normalize_lowercases_and_strips_gmail_dots():
    assert normalize_email("C.Person@Gmail.com") == "cperson@gmail.com"


def test_normalize_strips_plus_tags_outside_github():
    assert normalize_email("aworker+tag@gmail.com") == "aworker@gmail.com"


def test_normalize_keeps_dots_outside_gmail():
    assert normalize_email("a.worker@university.example") == "a.worker@university.example"


def test_normalize_preserves_the_github_login_after_the_plus():
    email = "11111111+aworker@users.noreply.github.com"
    assert normalize_email(email) == email
    assert github_login(email) == "aworker"


def test_github_login_is_none_for_a_normal_address():
    assert github_login("aworker2@gmail.com") is None


def test_bots_are_detected_by_email_or_name():
    assert is_bot("49699333+dependabot[bot]@users.noreply.github.com", "dependabot[bot]")
    assert is_bot("198982749+Copilot@users.noreply.github.com", "copilot-swe-agent[bot]")
    assert is_bot("gitbutler@gitbutler.com", "GitButler")
    assert not is_bot("aworker2@gmail.com", "A Worker")


def test_identity_hash_is_stable_and_reveals_no_address():
    h = identity_hash("a.worker@employer.example")
    assert h == identity_hash("A.Worker@Employer.Example")
    assert "worker" not in h and len(h) == 16


def test_one_email_two_display_names_collapses_to_one_contributor():
    resolutions, contributors = resolve(
        [ident("c.person@gmail.com", "CP1", 39), ident("c.person@gmail.com", "C Person", 1)]
    )
    assert len(contributors) == 1
    assert {r.rule_kind for r in resolutions} == {"singleton", "normalized_email"}


def test_two_github_noreply_addresses_for_one_login_collapse():
    resolutions, contributors = resolve(
        [
            ident("1+someone@users.noreply.github.com", "Someone", 5),
            ident("2+someone@users.noreply.github.com", "Someone Else", 1),
        ]
    )
    assert len(contributors) == 1
    assert any(r.rule_kind == "github_noreply_login" for r in resolutions)


def test_unrelated_addresses_stay_separate_without_an_override():
    _, contributors = resolve(
        [ident("bcollab@gmail.com", "B Collab", 21), ident("22222222+bcollab@users.noreply.github.com", "B Collab", 45)]
    )
    assert len(contributors) == 2


def test_an_override_merges_what_no_rule_could():
    identities = [
        ident("bcollab@gmail.com", "B Collab", 21),
        ident("22222222+bcollab@users.noreply.github.com", "B Collab", 45),
    ]
    overrides = {identity_hash(i.email): "group-b" for i in identities}
    resolutions, contributors = resolve(identities, overrides)
    assert len(contributors) == 1
    assert all(r.rule_kind == "manual_override" for r in resolutions)
    assert next(iter(contributors.values()))["total_commits"] == 66


def test_the_canonical_name_comes_from_the_busiest_identity():
    identities = [
        ident("a@example.com", "Quiet Name", 2),
        ident("b@example.com", "Busy Name", 200),
    ]
    overrides = {identity_hash(i.email): "g" for i in identities}
    _, contributors = resolve(identities, overrides)
    assert next(iter(contributors.values()))["canonical_name"] == "Busy Name"


def test_a_bot_is_never_merged_into_a_human_even_by_override():
    identities = [
        ident("aworker2@gmail.com", "A Worker", 100),
        ident("49699333+dependabot[bot]@users.noreply.github.com", "dependabot[bot]", 29),
    ]
    overrides = {identity_hash(i.email): "group-a" for i in identities}
    _, contributors = resolve(identities, overrides)
    assert len(contributors) == 2
    assert sorted(c["is_bot"] for c in contributors.values()) == [False, True]


def test_every_identity_gets_exactly_one_auditable_resolution():
    identities = [
        ident("aworker2@gmail.com", "A Worker", 1004),
        ident("11111111+aworker@users.noreply.github.com", "A Worker", 586),
        ident("a.worker@employer.example", "aworker-emp", 44),
    ]
    overrides = {identity_hash(i.email): "group-a" for i in identities}
    resolutions, contributors = resolve(identities, overrides)
    assert len(resolutions) == len(identities)
    assert len({r.identity_id for r in resolutions}) == len(identities)
    assert len(contributors) == 1
    assert all(0.0 < r.confidence <= 1.0 and r.evidence for r in resolutions)


def test_contributors_expose_a_hash_not_a_raw_email():
    _, contributors = resolve([ident("a.worker@employer.example", "aworker-emp", 44)])
    blob = repr(contributors)
    assert "employer" not in blob and "@" not in blob
