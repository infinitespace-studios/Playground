using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: ReferenceIdentity <assembly>...");
    return 2;
}

foreach (var path in args)
{
    try
    {
        var identity = AssemblyName.GetAssemblyName(path);
        var token = identity.GetPublicKeyToken();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            path,
            simpleName = identity.Name,
            version = identity.Version?.ToString(),
            publicKeyToken = token is { Length: > 0 }
                ? Convert.ToHexString(token).ToLowerInvariant()
                : null,
            informationalVersion = FileVersionInfo.GetVersionInfo(path).ProductVersion,
            sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)))
                .ToLowerInvariant(),
        }));
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Unable to inspect assembly {path}: {exception.Message}");
        return 1;
    }
}

return 0;
