# Develop and Publish

## Developing

```bash
npm run watch
```

## Publish

Change the version in `package.json` and push. This must trigger the `tag-release` workflow to create a new tag, which in turn must trigger the `publish` workflow.
