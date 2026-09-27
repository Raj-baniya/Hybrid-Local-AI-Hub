use std::collections::HashMap;
use std::fs;
use std::path::Path;

use anyhow::{anyhow, Result};
use regex::Regex;
use blake3::Hasher;

#[derive(Debug, Clone)]
pub enum VerificationAssertion {
    FileExists { path: String },
    FileAbsent { path: String },
    HashEquals { path: String, expected_hash: String },
    ContentMatches { path: String, pattern: String },
    NumericEquals { value: f64, expected: f64 },
    WithinTolerance { value: f64, expected: f64, tolerance: f64 },
}

#[derive(Debug, Clone)]
pub struct VerificationResult {
    pub assertion: VerificationAssertion,
    pub passed: bool,
    pub actual_value: String,
    pub reason: String,
}

pub fn verify_assertion(
    assertion: &VerificationAssertion,
    _context: &HashMap<String, String>,
) -> Result<VerificationResult> {
    let result = match assertion {
        VerificationAssertion::FileExists { path } => {
            let path = Path::new(path);
            let exists = path.exists();
            let is_file = path.is_file();
            VerificationResult {
                assertion: assertion.clone(),
                passed: is_file,
                actual_value: if exists {
                    if is_file { "file".to_string() } else { "directory".to_string() }
                } else { "not_exists".to_string() },
                reason: if is_file {
                    format!("File exists at: {}", path.display())
                } else if exists {
                    format!("Path exists but is a directory, not a file: {}", path.display())
                } else {
                    format!("File does not exist at: {}", path.display())
                },
            }
        }

        VerificationAssertion::FileAbsent { path } => {
            let path = Path::new(path);
            let absent = !path.exists();
            VerificationResult {
                assertion: assertion.clone(),
                passed: absent,
                actual_value: if absent { "absent".to_string() } else { "exists".to_string() },
                reason: if absent {
                    format!("File is absent as expected: {}", path.display())
                } else {
                    format!("File unexpectedly exists at: {}", path.display())
                },
            }
        }

        VerificationAssertion::HashEquals { path, expected_hash } => {
            let path = Path::new(path);
            let actual_hash = if path.exists() {
                match compute_file_hash(path) {
                    Ok(h) => h.to_string(),
                    Err(e) => format!("error: {}", e),
                }
            } else {
                "file_not_found".to_string()
            };
            let passed = actual_hash == *expected_hash;
            VerificationResult {
                assertion: assertion.clone(),
                passed,
                actual_value: actual_hash.clone(),
                reason: if passed {
                    format!("Hash matches expected value for: {}", path.display())
                } else {
                    format!("Hash mismatch for {}: expected {}, got {}", path.display(), expected_hash, actual_hash)
                },
            }
        }

        VerificationAssertion::ContentMatches { path, pattern } => {
            let path = Path::new(path);
            if !path.exists() {
                return Ok(VerificationResult {
                    assertion: assertion.clone(),
                    passed: false,
                    actual_value: "file_not_found".to_string(),
                    reason: format!("File not found at {}", path.display()),
                });
            }
            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => {
                    return Ok(VerificationResult {
                        assertion: assertion.clone(),
                        passed: false,
                        actual_value: "read_error".to_string(),
                        reason: format!("Could not read file {}: {}", path.display(), e),
                    });
                }
            };

            let (passed, match_detail) = match Regex::new(pattern) {
                Ok(re) => {
                    let matches = re.is_match(&content);
                    (matches, if matches { "pattern matched".to_string() } else { "pattern not matched".to_string() })
                }
                Err(e) => (false, format!("invalid_regex: {}", e)),
            };

            VerificationResult {
                assertion: assertion.clone(),
                passed,
                actual_value: match_detail.clone(),
                reason: if passed {
                    format!("Content matches pattern in: {}", path.display())
                } else {
                    format!("Content does not match pattern '{}' in {}: {}", pattern, path.display(), match_detail)
                },
            }
        }

        VerificationAssertion::NumericEquals { value, expected } => {
            let passed = *value == *expected;
            VerificationResult {
                assertion: assertion.clone(),
                passed,
                actual_value: value.to_string(),
                reason: if passed {
                    format!("Numeric value {} equals expected {}", value, expected)
                } else {
                    format!("Numeric value {} does not equal expected {}", value, expected)
                },
            }
        }

        VerificationAssertion::WithinTolerance { value, expected, tolerance } => {
            let passed = (*value - *expected).abs() <= *tolerance;
            VerificationResult {
                assertion: assertion.clone(),
                passed,
                actual_value: value.to_string(),
                reason: if passed {
                    format!("Value {} is within tolerance {} of expected {}", value, tolerance, expected)
                } else {
                    format!("Value {} is outside tolerance {} of expected {}", value, tolerance, expected)
                },
            }
        }
    };

    Ok(result)
}

fn compute_file_hash(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path).map_err(|e| anyhow!("Failed to open file '{}': {}", path.display(), e))?;
    let mut hasher = Hasher::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| anyhow!("Failed to hash file '{}': {}", path.display(), e))?;
    let hash = hasher.finalize();
    Ok(hash.to_hex().to_string())
}
