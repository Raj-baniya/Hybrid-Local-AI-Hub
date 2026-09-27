use sysinfo::System;

fn main() {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu_usage();
    let cpus = sys.cpus();
    println!("CPUs len: {}", cpus.len());
    
    let mut sys_all = System::new_all();
    sys_all.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys_all.refresh_cpu_usage();
    let cpus_all = sys_all.cpus();
    println!("CPUs len (new_all): {}", cpus_all.len());
}
