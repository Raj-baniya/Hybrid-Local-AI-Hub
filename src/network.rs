use tokio::net::TcpStream;
use std::time::Duration;

/// Quickly checks if the internet is accessible by attempting a TCP connection to Cloudflare DNS.
pub async fn check_internet_connection() -> bool {
    let addrs = ["1.1.1.1:53", "8.8.8.8:53"];
    
    for addr in addrs {
        if let Ok(_) = tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(addr)).await {
            return true;
        }
    }
    
    false
}
