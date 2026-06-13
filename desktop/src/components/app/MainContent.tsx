import type { AppState } from "../../hooks/useAppState";
import type { ArtistActions } from "../../hooks/useArtistActions";
import type { LibraryActions } from "../../hooks/useLibraryActions";
import type { SettingsActions } from "../../hooks/useSettingsActions";
import type { SimilarActions } from "../../hooks/useSimilarActions";
import { ArtistsView } from "../ArtistsView";
import { LibraryTab } from "../library/LibraryTab";
import { LogsView } from "../LogsView";
import { SettingsView } from "../SettingsView";
import { SimilarView } from "../SimilarView";
import { UnmatchedView } from "../UnmatchedView";

export function MainContent({
  state: s,
  settingsActions,
  artistActions,
  similarActions,
  libraryActions
}: {
  state: AppState;
  settingsActions: SettingsActions;
  artistActions: ArtistActions;
  similarActions: SimilarActions;
  libraryActions: LibraryActions;
}) {
  return (
    <main>
      {s.activeTab === "artists" ? (
        <ArtistsView
          language={s.language}
          artists={s.artists}
          artistTags={s.artistTags}
          selected={s.selected}
          filter={s.filter}
          busy={s.libraryBusy}
          setFilter={s.setFilter}
          toggleArtist={artistActions.toggleArtist}
          selectAll={(ids) => s.setSelected((current) => new Set([...current, ...ids]))}
          clearAll={() => s.setSelected(new Set())}
          scan={artistActions.scan}
          checkUpdates={artistActions.checkUpdates}
          checkArtistUpdates={artistActions.checkArtistUpdates}
          refreshArtistNames={artistActions.refreshArtistNames}
          downloadUpdated={artistActions.downloadUpdated}
          downloadArtistUpdated={artistActions.downloadArtistUpdated}
          openSelected={artistActions.openSelected}
          copyUrls={artistActions.copyUrls}
          copyArtistUrl={artistActions.copyArtistUrl}
          removeSelectedArtists={artistActions.removeSelectedArtists}
          addArtist={artistActions.addArtist}
          editArtist={artistActions.editArtist}
          setFavorite={artistActions.setFavorite}
          addTag={artistActions.addTag}
          assignTag={artistActions.assignTag}
          renameTag={artistActions.renameTag}
          deleteTag={artistActions.deleteTag}
          removeArtist={artistActions.removeArtist}
          openArtist={artistActions.openArtist}
          openPath={s.revealFile}
        />
      ) : null}
      {s.activeTab === "unmatched" ? (
        <UnmatchedView
          language={s.language}
          folders={s.unmatchedFolders}
          pendingExclude={s.pendingExcludeFolders}
          excludeFolder={artistActions.excludeFolder}
          assignFolder={artistActions.assignUnmatchedFolder}
          openPath={s.revealFile}
        />
      ) : null}
      {s.activeTab === "similar" ? (
        <SimilarView
          language={s.language}
          result={s.similarResult}
          threshold={s.settings.similar_threshold || "likely"}
          skipPixivPages={Boolean(s.settings.similar_skip_pixiv_pages)}
          busy={s.similarBusy}
          expanded={s.expandedGroups}
          roots={s.similarRoots}
          excludes={s.similarExcludes}
          rootBoxHeight={s.similarRootBoxHeight}
          excludeBoxHeight={s.similarExcludeBoxHeight}
          setRoots={s.setSimilarRoots}
          setExcludes={s.setSimilarExcludes}
          setRootBoxHeight={s.setSimilarRootBoxHeight}
          setExcludeBoxHeight={s.setSimilarExcludeBoxHeight}
          setThreshold={(value) => s.setSettings({ ...s.settings, similar_threshold: value })}
          setSkipPixivPages={(value) => s.setSettings({ ...s.settings, similar_skip_pixiv_pages: value })}
          findSimilar={similarActions.findSimilar}
          toggleGroup={similarActions.toggleGroup}
          revealFile={s.revealFile}
          cleanupSummary={s.cleanupSummary}
          quarantineEntries={similarActions.quarantineEntries}
          restoreCleanupItems={similarActions.restoreCleanupItems}
          deleteCleanupItems={similarActions.deleteCleanupItems}
          ignoreGroup={similarActions.ignoreGroup}
          unignoreGroup={similarActions.unignoreGroup}
        />
      ) : null}
      {s.activeTab === "library" ? <LibraryTab state={s} actions={libraryActions} /> : null}
      {s.activeTab === "settings" ? (
        <SettingsView
          language={s.language}
          settings={s.settings}
          cookieConsent={s.cookieConsent}
          pixivCookie={s.pixivCookie}
          projectRoot={s.projectRootValue}
          pythonCommand={s.pythonCommandValue}
          setLanguage={settingsActions.setLanguage}
          setSettings={s.setSettings}
          onToggleConsent={settingsActions.onToggleConsent}
          viewDisclaimer={() => s.setDisclaimer("view")}
          setPixivCookie={s.setPixivCookie}
          setProjectRootValue={s.setProjectRootState}
          setPythonCommandValue={s.setPythonCommandState}
          openReleasePage={settingsActions.openReleasePage}
          openPath={s.revealFile}
          resetWindowLayout={() => void settingsActions.resetWindowLayout()}
          resetSettings={settingsActions.resetSettings}
          busy={s.anyBusy}
          notify={(message) => s.appendLog("warn", message)}
        />
      ) : null}
      {s.activeTab === "logs" ? <LogsView logs={s.logs} /> : null}
    </main>
  );
}
