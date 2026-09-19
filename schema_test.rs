fn main() {
    let schema = schemars::schema_for!(hybrid_local_ai_hub::schema::Graph);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
