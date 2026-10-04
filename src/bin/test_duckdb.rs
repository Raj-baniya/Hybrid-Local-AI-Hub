use duckdb::Connection;
fn main() {
    let conn = Connection::open_in_memory().unwrap();
    let q = "SELECT 1 as id, 'Alice' as name";
    let wrapped = format!("SELECT CAST(row_to_json(tbl) AS VARCHAR) FROM ({}) AS tbl", q);
    let mut stmt = conn.prepare(&wrapped).unwrap();
    let mut rows = stmt.query([]).unwrap();
    let mut results = vec![];
    while let Some(row) = rows.next().unwrap() {
        let json_str: String = row.get(0).unwrap();
        results.push(json_str);
    }
    println!("[{}]", results.join(","));
}