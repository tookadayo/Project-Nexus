param([Parameter(Mandatory=$true)][string]$Path,[switch]$Verify)
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $Path -Force
if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Credential path cannot be a reparse point.' }
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed = @($owner.Value,'S-1-5-18','S-1-5-32-544')
if (-not $Verify) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $acl.SetOwner($owner)
    foreach ($sid in $allowed) {
        $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
        $inherit = if ($item.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl',$inherit,'None','Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
$acl = Get-Acl -LiteralPath $Path
if (-not $acl.AreAccessRulesProtected) { throw 'Credential ACL inheritance must be disabled.' }
foreach ($rule in @($acl.Access)) {
    $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid) { throw 'Credential ACL permits another principal.' }
}
$ownerSid = ([System.Security.Principal.NTAccount]::new([string]$acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
if ($allowed -notcontains $ownerSid) { throw 'Credential owner is not allowed.' }
