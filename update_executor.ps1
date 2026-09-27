$file = Join-Path -Path $PSScriptRoot -ChildPath 'src\executor.rs'
$content = Get-Content $file -Raw

# Add verification import if not present
if ($content -notmatch 'use crate::verification') {
    $content = $content -replace 'use crate::execution_record::\{ExecutionRecord, NodeRecord, NodeStatus\};', "use crate::execution_record::{ExecutionRecord, NodeRecord, NodeStatus};`nuse crate::verification::{verify_assertion, VerificationAssertion};"
}

# Update node_type_name to include verification nodes
$content = $content -replace 'NodeType::MergeNode\(_\) => "MergeNode",', "NodeType::MergeNode(_) => `"MergeNode`",`n        NodeType::FileVerifierNode(_) => `"FileVerifierNode`",`n        NodeType::DataVerifierNode(_) => `"DataVerifierNode`","

Set-Content $file -Value $content -NoNewline
Write-Host "Updated executor.rs successfully"
