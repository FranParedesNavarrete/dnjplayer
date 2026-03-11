/// Anime4K shader presets for different source resolutions
/// Mode A: Optimized for 1080p anime
/// Mode B: Optimized for 720p anime
/// Mode C: Optimized for 480p/SD anime

pub struct ShaderPreset {
    pub name: &'static str,
    pub mode: &'static str,
    pub description: &'static str,
    pub shaders: &'static [&'static str],
}

pub const MODE_A: ShaderPreset = ShaderPreset {
    name: "Mode A (1080p)",
    mode: "A",
    description: "Best for 1080p anime content",
    shaders: &[
        "Anime4K_Clamp_Highlights.glsl",
        "Anime4K_Restore_CNN_VL.glsl",
        "Anime4K_Upscale_CNN_x2_VL.glsl",
        "Anime4K_AutoDownscalePre_x2.glsl",
        "Anime4K_AutoDownscalePre_x4.glsl",
        "Anime4K_Upscale_CNN_x2_M.glsl",
    ],
};

pub const MODE_B: ShaderPreset = ShaderPreset {
    name: "Mode B (720p)",
    mode: "B",
    description: "Best for 720p anime content",
    shaders: &[
        "Anime4K_Clamp_Highlights.glsl",
        "Anime4K_Restore_CNN_Soft_VL.glsl",
        "Anime4K_Upscale_CNN_x2_VL.glsl",
        "Anime4K_AutoDownscalePre_x2.glsl",
        "Anime4K_AutoDownscalePre_x4.glsl",
        "Anime4K_Upscale_CNN_x2_M.glsl",
    ],
};

pub const MODE_C: ShaderPreset = ShaderPreset {
    name: "Mode C (480p)",
    mode: "C",
    description: "Best for 480p/SD anime content",
    shaders: &[
        "Anime4K_Clamp_Highlights.glsl",
        "Anime4K_Upscale_Denoise_CNN_x2_VL.glsl",
        "Anime4K_AutoDownscalePre_x2.glsl",
        "Anime4K_AutoDownscalePre_x4.glsl",
        "Anime4K_Upscale_CNN_x2_VL.glsl",
    ],
};

pub fn get_preset(mode: &str) -> Option<&'static ShaderPreset> {
    match mode {
        "A" => Some(&MODE_A),
        "B" => Some(&MODE_B),
        "C" => Some(&MODE_C),
        _ => None,
    }
}
