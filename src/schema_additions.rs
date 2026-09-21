#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileVerifierConfig {
    pub path: String,
    pub assertion: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataVerifierConfig {
    pub content: String,
    pub pattern: Option<String>,
}
