import os

ROOT = "e:/Hybrid Local AI Hub"

def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as f:
        return f.read()

def write(path, content):
    with open(os.path.join(ROOT, path), "w", encoding="utf-8") as f:
        f.write(content)

c = read("src/providers.rs")

# Add the get_api_key helper method to ProviderManager
old_is_offline = """    pub fn is_offline(&self) -> bool {
        self.is_offline
    }"""
new_is_offline = """    pub fn is_offline(&self) -> bool {
        self.is_offline
    }

    /// Resolve API key checking OS credential store first, fallback to `online_keys`.
    fn get_api_key(&self, provider_name: &str, fallback_key: &str) -> String {
        if let Ok(entry) = keyring::Entry::new("hybrid-local-ai-hub", provider_name) {
            if let Ok(pw) = entry.get_password() {
                return pw;
            }
        }
        fallback_key.to_string()
    }"""
c = c.replace(old_is_offline, new_is_offline, 1)

# Modify the generate method to use it
old_auth_header = """                    let res = self.client.post(url)
                        .header("Authorization", format!("Bearer {}", config.key))
                        .header("Content-Type", "application/json")"""
new_auth_header = """                    let actual_key = self.get_api_key(&config.name, &config.key);
                    let res = self.client.post(url)
                        .header("Authorization", format!("Bearer {}", actual_key))
                        .header("Content-Type", "application/json")"""
c = c.replace(old_auth_header, new_auth_header, 1)

write("src/providers.rs", c)
print("Updated src/providers.rs for keyring")
