import { RepoPicker } from "../../components/RepoPicker";
import { WatchedRepos } from "../../components/WatchedRepos";
import { TabHeading } from "./SettingsLayout";

export function ReposTab() {
  return (
    <>
      <TabHeading title="Repositories">
        Git Buddy only looks at these repos. New ones show up in your list
        within a minute.
      </TabHeading>
      <WatchedRepos />
      <RepoPicker />
    </>
  );
}
