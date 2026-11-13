//! Local-only account operation journal. Uses the existing Host kv boundary.
use super::*;

const KEY: &str = "iterate-account-v1";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u32,
    revision: u64,
    installation: String,
    active_user: Option<u64>,
    redemption_user: Option<u64>,
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
    providers: Vec<ProviderBinding>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderBinding {
    id: String,
    style: String,
}

fn parse(value: Value) -> Result<Journal, JsonRpcError> {
    let journal: Journal = serde_json::from_value(value)
        .map_err(|_| rpc_err(1002, "invalid account journal", "INVALID_PARAMS"))?;
    let bounded =
        |s: &str, max: usize| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control);
    if journal.version != 1
        || journal.installation.len() != 24
        || !journal.installation.bytes().all(|b| b.is_ascii_hexdigit())
        || journal.records.len() > 1000
        || journal.active_user == Some(0)
        || journal.redemption_user == Some(0)
        || journal.records.iter().any(|record| {
            record.user == 0
                || !bounded(&record.group, 200)
                || !record.name.starts_with("iterate-pi-")
                || !bounded(&record.name, 100)
                || !matches!(record.state.as_str(), "prepared" | "pending" | "created")
                || record.token_id == Some(0)
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
                parse(value.clone())?;
                Ok(value)
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
        let value = json!({"version":1,"revision":0,"installation":"0123456789abcdef01234567",
            "activeUser":7,"redemptionUser":null,"records":[{"user":7,"group":"default",
            "name":"iterate-pi-test","state":"pending","tokenId":null,"providers":[]}]});
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
