using System.Text.Json;

namespace PAiA.WinUI.Services.Packs;

public sealed class PacksRegistry
{
    private readonly IReadOnlyList<Pack> _packs;

    public PacksRegistry(string jsonPath)
    {
        var json = File.ReadAllText(jsonPath);
        _packs = JsonSerializer.Deserialize<List<Pack>>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? [];
    }

    public IReadOnlyList<Pack> List() => _packs;
    public Pack Get(string id) => _packs.First(p => p.Id == id);
    public Pack? TryGet(string id) => _packs.FirstOrDefault(p => p.Id == id);
}
