$file = 'E:\Hybrid Local AI Hub\src\executor.rs'
$content = Get-Content $file -Raw

# Add verification import if not present
if ($content -notmatch 'use crate::verification') {
    $content = $content -replace 'use crate::execution_record::\{ExecutionRecord, NodeRecord, NodeStatus\};', 'use crate::execution_record::{ExecutionRecord, NodeRecord, NodeStatus};`r`nuse crate::verification::{verify_assertion, VerificationAssertion};'
}

# Update node_type_name to include verification nodes
$content = $content -replace 'NodeType::MergeNode\(_\) => "MergeNode",', 'NodeType::MergeNode(_) => "MergeNode",`r`n        NodeType::FileVerifierNode(_) => "FileVerifierNode",`r`n        NodeType::DataVerifierNode(_) => "DataVerifierNode",'

Set-Content $file -Value $content -NoNewline
Write-Host "Updated executor.rs successfully"
