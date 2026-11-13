//! Local-only account operation journal. Uses the existing Host kv boundary.
use super::*;

// Retain the original storage key so v1 journals migrate without a manual
// reset. The stored schema version is carried inside the value.
const KEY: &str = "iterate-account-v1";
const CURRENT_VERSION: u32 = 2;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u32,
    revision: u64,
    installation: String,
    active_user: Option<u64>,
    redemption_users: Vec<u64>,
    records: Vec<KeyRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyRecord {
    user: u64,
    group: String,
    name: String,
    state: String,
    token_id: Option<u64>,
    rotation_pending: bool,
    providers: Vec<ProviderBinding>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderBinding {
    id: String,
    style: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyJournal {
    version: u32,
    revision: u64,
    installation: String,
    active_user: Option<u64>,
    redemption_user: Option<u64>,
    records: Vec<LegacyKeyRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyKeyRecord {
    user: u64,
    group: String,
    name: String,
    state: String,
    token_id: Option<u64>,
    providers: Vec<ProviderBinding>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum PersistedJournal {
    Current(Journal),
    Legacy(LegacyJournal),
}

fn parse(value: Value) -> Result<Journal, JsonRpcError> {
    let persisted: PersistedJournal = serde_json::from_value(value)
        .map_err(|_| rpc_err(1002, "invalid account journal", "INVALID_PARAMS"))?;
    let journal = match persisted {
        PersistedJournal::Current(journal) => journal,
        PersistedJournal::Legacy(legacy) => {
            if legacy.version != 1 {
                return Err(rpc_err(1002, "invalid account journal", "INVALID_PARAMS"));
            }
            Journal {
                version: CURRENT_VERSION,
                revision: legacy.revision,
                installation: legacy.installation,
                active_user: legacy.active_user,
                redemption_users: legacy.redemption_user.into_iter().collect(),
                records: legacy
                    .records
                    .into_iter()
                    .map(|record| KeyRecord {
                        user: record.user,
                        group: record.group,
                        name: record.name,
                        state: record.state,
                        token_id: record.token_id,
                        rotation_pending: false,
                        providers: record.providers,
                    })
                    .collect(),
            }
        }
    };
    const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    let bounded =
        |s: &str, max: usize| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control);
    let valid_id = |id: u64| id > 0 && id <= JS_MAX_SAFE_INTEGER;
    if journal.version != CURRENT_VERSION
        || journal.installation.len() != 24
        || !journal.installation.bytes().all(|b| b.is_ascii_hexdigit())
        || journal.records.len() > 1000
        || journal.redemption_users.len() > 1000
        || journal.active_user.is_some_and(|id| !valid_id(id))
        || journal.redemption_users.iter().any(|id| !valid_id(*id))
        || journal.records.iter().any(|record| {
            !valid_id(record.user)
                || !bounded(&record.group, 200)
                || !record.name.starts_with("iterate-pi-")
                || !bounded(&record.name, 100)
                || !matches!(record.state.as_str(), "prepared" | "pending" | "created")
                || record.token_id.is_some_and(|id| !valid_id(id))
                || (record.state == "created") != record.token_id.is_some()
                || record.providers.len() > 3
                || record.providers.iter().any(|provider| {
                    !bounded(&provider.id, 100)
                        || !matches!(
                            provider.style.as_str(),
                            "chat_completions" | "responses" | "anthropic_messages"
                        )
                })
        })
    {
        return Err(rpc_err(1002, "invalid account journal", "INVALID_PARAMS"));
    }
    let mut account_groups = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    let mut token_ids = std::collections::HashSet::new();
    let mut provider_ids = std::collections::HashSet::new();
    let mut redemption_users = std::collections::HashSet::new();
    if journal
        .redemption_users
        .iter()
        .any(|user| !redemption_users.insert(*user))
    {
        return Err(rpc_err(1002, "invalid account journal", "INVALID_PARAMS"));
    }
    for record in &journal.records {
        if !account_groups.insert((record.user, record.group.as_str()))
            || !names.insert((record.user, record.name.as_str()))
            || record.token_id.is_some_and(|id| !token_ids.insert(id))
            || record
                .providers
                .iter()
                .any(|provider| !provider_ids.insert(provider.id.as_str()))
        {
            return Err(rpc_err(1002, "invalid account journal", "INVALID_PARAMS"));
        }
        let mut styles = std::collections::HashSet::new();
        if record
            .providers
            .iter()
            .any(|provider| !styles.insert(provider.style.as_str()))
        {
            return Err(rpc_err(1002, "invalid account journal", "INVALID_PARAMS"));
        }
    }
    Ok(journal)
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
) -> Result<Value, JsonRpcError> {
    let st = state.lock().await;
    let stored = st
        .db
        .get_setting(KEY)
        .map_err(|_| rpc_err(1000, "account journal unavailable", "INTERNAL"))?;
    match method {
        "iterateAccount.get" => {
            if let Some(value) = stored {
                serde_json::to_value(parse(value)?)
                    .map_err(|_| rpc_err(1000, "account journal unavailable", "INTERNAL"))
            } else {
                Ok(Value::Null)
            }
        }
        "iterateAccount.set" => {
            let mut next = parse(params)?;
            let revision = stored
                .map(parse)
                .transpose()?
                .map(|j| j.revision)
                .unwrap_or(0);
            if next.revision != revision || revision == u64::MAX {
                return Err(rpc_err(1002, "account journal changed", "INVALID_PARAMS"));
            }
            next.revision += 1;
            let value = serde_json::to_value(next)
                .map_err(|_| rpc_err(1000, "account journal unavailable", "INTERNAL"))?;
            st.db
                .set_setting(KEY, &value)
                .map_err(|_| rpc_err(1000, "account journal unavailable", "INTERNAL"))?;
            Ok(value)
        }
        _ => Err(rpc_err(1002, "unknown account operation", "INVALID_PARAMS")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_rejects_ambiguous_records_and_impossible_states() {
        let journal = |records: Value| {
            json!({
                "version": 2,
                "revision": 0,
                "installation": "0123456789abcdef01234567",
                "activeUser": 7,
                "redemptionUsers": [7, 8],
                "records": records
            })
        };
        let record = |group: &str, name: &str, token_id: u64, providers: Value| {
            json!({
                "user": 7,
                "group": group,
                "name": name,
                "state": "created",
                "tokenId": token_id,
                "rotationPending": false,
                "providers": providers
            })
        };
        let chat = json!([{"id": "provider-a", "style": "chat_completions"}]);
        assert!(parse(journal(json!([record("default", "iterate-pi-a", 1, chat)]))).is_ok());

        let duplicate_group = journal(json!([
            record("default", "iterate-pi-a", 1, json!([])),
            record("default", "iterate-pi-b", 2, json!([]))
        ]));
        assert!(parse(duplicate_group).is_err());

        let duplicate_token = journal(json!([
            record("one", "iterate-pi-a", 1, json!([])),
            record("two", "iterate-pi-b", 1, json!([]))
        ]));
        assert!(parse(duplicate_token).is_err());

        let duplicate_provider = journal(json!([
            record(
                "one",
                "iterate-pi-a",
                1,
                json!([
                    {"id": "provider-a", "style": "chat_completions"}
                ])
            ),
            record(
                "two",
                "iterate-pi-b",
                2,
                json!([
                    {"id": "provider-a", "style": "responses"}
                ])
            )
        ]));
        assert!(parse(duplicate_provider).is_err());

        let duplicate_style = journal(json!([record(
            "default",
            "iterate-pi-a",
            1,
            json!([
                {"id": "provider-a", "style": "chat_completions"},
                {"id": "provider-b", "style": "chat_completions"}
            ])
        )]));
        assert!(parse(duplicate_style).is_err());

        let missing_created_token = journal(json!([{
            "user": 7,
            "group": "default",
            "name": "iterate-pi-a",
            "state": "created",
            "tokenId": null,
            "rotationPending": false,
            "providers": []
        }]));
        assert!(parse(missing_created_token).is_err());

        let prepared_with_token = journal(json!([{
            "user": 7,
            "group": "default",
            "name": "iterate-pi-a",
            "state": "prepared",
            "tokenId": 1,
            "rotationPending": false,
            "providers": []
        }]));
        assert!(parse(prepared_with_token).is_err());

        let unsafe_user = journal(json!([{
            "user": 9_007_199_254_740_992_u64,
            "group": "default",
            "name": "iterate-pi-a",
            "state": "pending",
            "tokenId": null,
            "rotationPending": true,
            "providers": []
        }]));
        assert!(parse(unsafe_user).is_err());

        let duplicate_redemption_user = json!({
            "version": 2,
            "revision": 0,
            "installation": "0123456789abcdef01234567",
            "activeUser": 7,
            "redemptionUsers": [7, 7],
            "records": []
        });
        assert!(parse(duplicate_redemption_user).is_err());
    }

    #[test]
    fn journal_migrates_v1_singleton_redemption_state() {
        let legacy = json!({
            "version": 1,
            "revision": 4,
            "installation": "0123456789abcdef01234567",
            "activeUser": 7,
            "redemptionUser": 7,
            "records": [{
                "user": 7,
                "group": "default",
                "name": "iterate-pi-legacy",
                "state": "created",
                "tokenId": 11,
                "providers": []
            }]
        });
        let migrated = parse(legacy).unwrap();
        assert_eq!(migrated.version, CURRENT_VERSION);
        assert_eq!(migrated.revision, 4);
        assert_eq!(migrated.redemption_users, vec![7]);
        assert!(!migrated.records[0].rotation_pending);
    }

    #[tokio::test]
    async fn journal_survives_restart_rejects_stale_writes_and_leaves_settings_intact() {
        let dir = tempfile::tempdir().unwrap();
        let open = || Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
        let first = open();
        first
            .lock()
            .await
            .db
            .set_setting("app", &json!({"theme":"light"}))
            .unwrap();
        let value = json!({"version":2,"revision":0,"installation":"0123456789abcdef01234567",
            "activeUser":7,"redemptionUsers":[7],"records":[{"user":7,"group":"default",
            "name":"iterate-pi-test","state":"pending","tokenId":null,
            "rotationPending":true,"providers":[]}]});
        let saved = handle(first.clone(), "iterateAccount.set", value.clone())
            .await
            .unwrap();
        assert_eq!(saved["revision"], 1);
        assert!(handle(first.clone(), "iterateAccount.set", value)
            .await
            .is_err());
        assert_eq!(
            first.lock().await.db.get_setting("app").unwrap().unwrap()["theme"],
            "light"
        );
        drop(first);
        let reopened = open();
        assert_eq!(
            handle(reopened.clone(), "iterateAccount.get", json!({}))
                .await
                .unwrap(),
            saved
        );
        let mut injected = saved;
        injected["accessToken"] = json!("must-never-be-stored");
        assert!(handle(reopened, "iterateAccount.set", injected)
            .await
            .is_err());
    }
}
