using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Xna.Framework;

namespace Playground.Preview;

public static partial class PreviewExports
{
    private const string MonoGameSourceSha256 = "9d2845d17767ffa295aed45f52d57bf9bc0f73b4e02cee8ac3cbe7502a0be836";
    private static readonly string RuntimeIdentity = Guid.NewGuid().ToString("D");
    private static int _callCount;

    [JSExport]
    public static string Ping()
    {
        var monoGameAssembly = typeof(Game).Assembly;
        var monoGameIdentity = monoGameAssembly.GetName();
        var proof = new PreviewContextProof(
            ProtocolVersion: 1,
            Message: "preview-context-alive",
            RuntimeIdentity,
            RuntimeStartupCount: 1,
            CallCount: ++_callCount,
            Configuration: "Release",
            PublishTrimmed: false,
            NativeAot: false,
            RunAOTCompilation: false,
            WasmEnableThreads: false,
            ExecutionMode: "interpreter",
            MonoGameAssemblyName: monoGameIdentity.Name!,
            MonoGameAssemblyVersion: monoGameIdentity.Version!.ToString(),
            MonoGameSourceSha256,
            SafeMetadataType: typeof(Game).FullName!);

        return JsonSerializer.Serialize(proof, PreviewJsonContext.Default.PreviewContextProof);
    }

    internal sealed record PreviewContextProof(
        int ProtocolVersion,
        string Message,
        string RuntimeIdentity,
        int RuntimeStartupCount,
        int CallCount,
        string Configuration,
        bool PublishTrimmed,
        bool NativeAot,
        bool RunAOTCompilation,
        bool WasmEnableThreads,
        string ExecutionMode,
        string MonoGameAssemblyName,
        string MonoGameAssemblyVersion,
        string MonoGameSourceSha256,
        string SafeMetadataType);
}

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
[JsonSerializable(typeof(PreviewExports.PreviewContextProof))]
internal sealed partial class PreviewJsonContext : JsonSerializerContext;
