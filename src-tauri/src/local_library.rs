use std::path::{Path, PathBuf};

use lofty::{file::{AudioFile, TaggedFileExt}, probe::Probe, tag::{Accessor, ItemKey, ItemValue}};
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

/// Reads lyrics for a local song on demand: embedded (USLT/©lyr) lyrics first,
/// then a sibling `<song>.lrc` file. Returns None when neither exists.
#[tauri::command]
pub async fn read_local_lyrics(path: String) -> Result<Option<String>, String> {
  tauri::async_runtime::spawn_blocking(move || lyrics_for_song(&PathBuf::from(&path)))
    .await
    .map_err(|error| format!("The lyrics lookup was interrupted: {error}"))?
}

fn lyrics_for_song(file: &Path) -> Result<Option<String>, String> {
  if !file.is_file() {
    return Err("The local song file no longer exists.".into());
  }
  if let Ok(tagged) = Probe::open(file).and_then(|probe| probe.read()) {
    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
      for item in tag.items() {
        // lofty maps ID3 USLT / MP4 ©lyr / Vorbis LYRICS to ItemKey::Lyrics, but FLAC
        // files also commonly store lyrics as UNSYNCEDLYRICS, which stays Unknown.
        let is_lyrics = match item.key() {
          ItemKey::Lyrics => true,
          ItemKey::Unknown(key) => matches!(key.to_ascii_uppercase().as_str(), "LYRICS" | "UNSYNCEDLYRICS" | "SYNCEDLYRICS"),
          _ => false,
        };
        if !is_lyrics {
          continue;
        }
        if let ItemValue::Text(text) | ItemValue::Locator(text) = item.value() {
          if !text.trim().is_empty() {
            return Ok(Some(text.clone()));
          }
        }
      }
    }
  }
  let sidecar = file.with_extension("lrc");
  if sidecar.is_file() {
    let text = std::fs::read_to_string(&sidecar).map_err(|error| format!("Unable to read the lyrics file: {error}"))?;
    if !text.trim().is_empty() {
      return Ok(Some(text));
    }
  }
  Ok(None)
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

  #[test]
  fn reads_sidecar_lrc_and_handles_missing_lyrics() {
    let root = std::env::temp_dir().join(format!("tenma-lyrics-test-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("song.wav");
    let data_len = 800_u32;
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

    assert_eq!(lyrics_for_song(&path).unwrap(), None);
    let lrc = "[00:01.00]First line\n[00:02.00]Second line";
    std::fs::write(root.join("song.lrc"), lrc).unwrap();
    assert_eq!(lyrics_for_song(&path).unwrap().as_deref(), Some(lrc));
    assert!(lyrics_for_song(&root.join("missing.wav")).is_err());
    std::fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn reads_flac_unsyncedlyrics_vorbis_comment() {
    // Minimal FLAC: fLaC + STREAMINFO (44.1kHz/16-bit/stereo) + Vorbis comment block
    // holding UNSYNCEDLYRICS, the field name many FLAC taggers use for lyrics.
    let root = std::env::temp_dir().join(format!("tenma-flac-lyrics-test-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let mut streaminfo = vec![0x00, 0x10, 0x00, 0x10, 0, 0, 0, 0, 0, 0, 0xAC, 0x44, 0x02, 0x78];
    streaminfo.resize(34, 0);
    let comment = "UNSYNCEDLYRICS=[00:01.00]Embedded words";
    let mut vorbis = Vec::new();
    vorbis.extend_from_slice(&4_u32.to_le_bytes());
    vorbis.extend_from_slice(b"test");
    vorbis.extend_from_slice(&1_u32.to_le_bytes());
    vorbis.extend_from_slice(&(comment.len() as u32).to_le_bytes());
    vorbis.extend_from_slice(comment.as_bytes());
    let mut flac = Vec::new();
    flac.extend_from_slice(b"fLaC");
    flac.push(0x00); // STREAMINFO, not the last block
    flac.extend_from_slice(&(streaminfo.len() as u32).to_be_bytes()[1..]);
    flac.extend_from_slice(&streaminfo);
    flac.push(0x84); // VORBIS_COMMENT, last block
    flac.extend_from_slice(&(vorbis.len() as u32).to_be_bytes()[1..]);
    flac.extend_from_slice(&vorbis);
    let path = root.join("song.flac");
    std::fs::write(&path, flac).unwrap();
    assert_eq!(lyrics_for_song(&path).unwrap().as_deref(), Some("[00:01.00]Embedded words"));
    std::fs::remove_dir_all(root).unwrap();
  }
}
