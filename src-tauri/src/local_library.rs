use std::path::{Path, PathBuf};

use lofty::{file::{AudioFile, TaggedFileExt}, probe::Probe, tag::Accessor};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac"];
const COVER_FILES: &[&str] = &["cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "folder.png"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSong {
  id: String,
  title: String,
  artist: String,
  album: String,
  duration: Option<f64>,
  track: Option<u32>,
  bit_rate: Option<u32>,
  path: String,
  cover_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibrary {
  folder: String,
  songs: Vec<LocalSong>,
}

#[tauri::command]
pub fn pick_local_library_folder(app: AppHandle, title: String) -> Option<String> {
  app
    .dialog()
    .file()
    .set_title(title)
    .blocking_pick_folder()
    .and_then(|folder| folder.into_path().ok())
    .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn scan_local_library(app: AppHandle, folder: String) -> Result<LocalLibrary, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let root = std::fs::canonicalize(&folder).map_err(|error| format!("Unable to open the local library folder: {error}"))?;
    if !root.is_dir() {
      return Err("The local library path is not a folder.".into());
    }
    app
      .asset_protocol_scope()
      .allow_directory(&root, true)
      .map_err(|error| format!("Unable to grant access to the local library: {error}"))?;

    let mut songs = Vec::new();
    for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_map(Result::ok) {
      if !entry.file_type().is_file() || !is_audio_file(entry.path()) {
        continue;
      }
      songs.push(read_song(entry.path(), &root));
    }
    songs.sort_by(|left, right| {
      (left.album.to_lowercase(), left.track.unwrap_or(u32::MAX), left.title.to_lowercase())
        .cmp(&(right.album.to_lowercase(), right.track.unwrap_or(u32::MAX), right.title.to_lowercase()))
    });
    Ok(LocalLibrary {
      folder: display_folder(&root),
      songs,
    })
  })
  .await
  .map_err(|error| format!("The local library scan was interrupted: {error}"))?
}

fn display_folder(path: &Path) -> String {
  let value = path.to_string_lossy().into_owned();
  #[cfg(windows)]
  {
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
      return format!(r"\\{unc}");
    }
    if let Some(local) = value.strip_prefix(r"\\?\") {
      return local.to_string();
    }
  }
  value
}

fn is_audio_file(path: &Path) -> bool {
  path
    .extension()
    .and_then(|extension| extension.to_str())
    .map(|extension| AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
    .unwrap_or(false)
}

fn read_song(path: &Path, root: &Path) -> LocalSong {
  let tagged = Probe::open(path).ok().and_then(|probe| probe.read().ok());
  let mut title = None;
  let mut artist = None;
  let mut album = None;
  let mut track = None;
  if let Some(file) = &tagged {
    if let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) {
      title = tag.title().map(|value| value.into_owned());
      artist = tag.artist().map(|value| value.into_owned());
      album = tag.album().map(|value| value.into_owned());
      track = tag.track();
    }
  }

  let title = title
    .filter(|value| !value.trim().is_empty())
    .or_else(|| path.file_stem().map(|value| value.to_string_lossy().into_owned()))
    .unwrap_or_else(|| "Untitled song".into());
  let album = album
    .filter(|value| !value.trim().is_empty())
    .or_else(|| path.parent().and_then(Path::file_name).map(|value| value.to_string_lossy().into_owned()))
    .or_else(|| root.file_name().map(|value| value.to_string_lossy().into_owned()))
    .unwrap_or_else(|| "Local library".into());
  let duration = tagged
    .as_ref()
    .map(|file| file.properties().duration().as_secs_f64())
    .filter(|value| value.is_finite() && *value > 0.0);
  let bit_rate = tagged.as_ref().and_then(|file| file.properties().audio_bitrate()).filter(|value| *value > 0);

  LocalSong {
    id: path.to_string_lossy().into_owned(),
    title,
    artist: artist.unwrap_or_default(),
    album,
    duration,
    track,
    bit_rate,
    path: path.to_string_lossy().into_owned(),
    cover_path: find_cover(path.parent().unwrap_or(root)),
  }
}

fn find_cover(folder: &Path) -> Option<String> {
  COVER_FILES
    .iter()
    .map(|name| folder.join(name))
    .find(|path| path.is_file())
    .map(|path: PathBuf| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_untagged_wav_with_filename_fallback_and_cover() {
    let root = std::env::temp_dir().join(format!("tenma-library-test-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("sample.wav");
    let data_len = 16_000_u32;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&8_000_u32.to_le_bytes());
    wav.extend_from_slice(&16_000_u32.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.resize(44 + data_len as usize, 0);
    std::fs::write(&path, wav).unwrap();
    std::fs::write(root.join("cover.jpg"), b"test-cover").unwrap();

    assert!(is_audio_file(&path));
    let song = read_song(&path, &root);
    assert_eq!(song.title, "sample");
    assert_eq!(song.album, root.file_name().unwrap().to_string_lossy());
    assert_eq!(song.duration, Some(1.0));
    assert_eq!(song.bit_rate, Some(128));
    assert!(song.cover_path.unwrap().ends_with("cover.jpg"));
    std::fs::remove_dir_all(root).unwrap();
  }
}
