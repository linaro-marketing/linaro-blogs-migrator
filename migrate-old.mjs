import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { read } from "to-vfile";
import fs from "fs/promises";
import extract from "remark-extract-frontmatter";
import { EXIT, visit } from "unist-util-visit";
import * as yaml from "yaml";
import "dotenv/config";
import * as cloudinary from "cloudinary";
import { Liquid } from "liquidjs";
import remarkGfm from "remark-gfm-no-autolink";
import remarkMdx from "remark-mdx";

const INPUT_AUTHORS_FOLDER = "./old_content/authors";
const INPUT_BLOGS_FOLDER = "./old_content/blogs";
const OLD_WEBSITE_PATH = "./website";
const OUTPUT_FOLDER = "./new_content";

// initialize the liquid engine, which can be used to find jekyll include blocks from the old website content
const liquidEngine = new Liquid({ jekyllInclude: true });

liquidEngine.registerTag("include", {
  parse(tagToken) {
    this.args = tagToken.args.split(" ");
  },
  render(context, emitter) {
    const index = Math.floor(this.args.length * Math.random());
    emitter.write(this.args[index]);
  },
});

// this function takes the path of an image referenced in the old Linaro website and converts it to the intended Cloudinary path
function transformImagePath(path, type) {
  if (!path) return;
  return (`linaro-website/images/${type}/` + path.split("/").slice(-1))
    .split(".")
    .slice(0, -1)
    .join(".")
    .split("?")[0];
}

// this converts all author references to a standard format with a hyphen between names
function transformAuthor(author) {
  return author
    .split("@")[0]
    .toLowerCase()
    .trim()
    .replace(".", "-")
    .replace("_", "-")
    .replace(" ", "-");
}

// the tags list provides the migrator with a list of tags from the old site and what tag on the new site they should be migrated to. The transformTag function performs the migration.
const tags = [
  { key: "android", name: "Android", migrate: ["Android", "AOSP"] },
  {
    key: "arm",
    name: "Arm",
    migrate: ["Arm", "ARM", "AArch64", "SystemReady"],
  },
  {
    key: "ai-ml",
    name: "AI & ML",
    migrate: ["Artificial Intelligence", "Machine Learning"],
  },
  {
    key: "automotive",
    name: "Automotive",
    migrate: ["Automotive", "Software defined Vehicle"],
  },
  { key: "ci", name: "CI", migrate: ["CI"] },
  {
    key: "datacenter",
    name: "Datacenter",
    migrate: ["Datacenter", "Big Data", "Server"],
  },
  {
    key: "hpc",
    name: "HPC",
    migrate: ["Supercomputing", "HPC", "LINARO FORGE", "Linaro Forge"],
  },
  {
    key: "iot-embedded",
    name: "IOT & Embedded",
    migrate: ["IoT", "Raspberry Pi", "OpenEmbedded", "RockPi4B", "Embedded"],
  },
  {
    key: "linaro-connect",
    name: "Linaro Connect",
    migrate: ["Linaro Connect"],
  },
  {
    key: "linux-kernel",
    name: "Linux Kernel",
    migrate: ["Linux Kernel", "Kernel Development", "Kernel Release", "LKFT"],
  },

  {
    key: "open-source",
    name: "Open Source",
    migrate: [
      "Open Source",
      "Debian",
      "GNU",
      "LLVM",
      "MCUboot",
      "OP-TEE",
      "Rust",
    ],
  },
  { key: "security", name: "Security", migrate: ["Security", "Encryption"] },
  { key: "toolchain", name: "Toolchain", migrate: ["Toolchain", "LAVA"] },
  {
    key: "virtualization",
    name: "Virtualization",
    migrate: ["Virtualization"],
  },
  {
    key: "windows-on-arm",
    name: "Windows on Arm",
    migrate: ["Windows On Arm"],
  },
  { key: "testing", name: "Testing", migrate: ["Testing", "LKFT"] },
  { key: "debugging", name: "Debugging", migrate: ["Debugging"] },
  { key: "u-boot", name: "U-Boot", migrate: ["U-boot", "U-Boot"] },
  { key: "qemu", name: "QEMU", migrate: ["QEMU"] },
];

function transformTag(tag) {
  const newTags = tags.filter((newTag) => newTag.migrate.includes(tag));
  return newTags.map((newTag) => newTag.key);
}

const blogs = await fs.readdir(INPUT_BLOGS_FOLDER);

blogs.forEach(async (blog) => {
  try {
    const file = await unified()
      .use(remarkParse)
      .use(remarkFrontmatter)
      .use(extract, { yaml: yaml.parse })
      .use(function () {
        return function (tree, file) {
          // data is the yaml frontmatter of the .md file
          const { data } = file;

          // convert old website image paths to intended Cloudinary image paths e.g. /linaro-website/images/blog/a-blog-image.jpg
          const imagePath = transformImagePath(data.image, "blog");
          const author = transformAuthor(data.author);

          // migrate tags to new shortened list of tags
          const tags = (data.tags ?? [])
            .map((tag) => transformTag(tag))
            .flat()
            .filter((tag, index, list) => list.indexOf(tag) === index);

          // upload images to Cloudinary from old website directory
          cloudinary.v2.uploader
            .upload(OLD_WEBSITE_PATH + data.image, {
              public_id: imagePath,
              overwrite: false,
              timeout: 60000000,
            })
            .then((result) => {
              if (result.existing === false) {
                console.log(result);
              }
            })
            .catch((err) => console.error(blog, err));

          // create migrated frontmatter data object
          const newData = {
            ...data,
            layout: undefined,
            category: undefined,
            wordpress_id: undefined,
            slug: undefined,
            author: author,
            image: imagePath,
            tags,
            related: [],
            date: new Date(data.date).toISOString(),
          };

          // the visit function finds a specific part of the markdown, e.g. "yaml" finds the frontmatter, "link" finds any link tags, "image" finds images.
          // These can then be mutated via the "splice" operator, replacing the node with the new migrated format

          // this block replaces the frontmatter with the new migrated data
          visit(tree, "yaml", (node, index, parent) => {
            parent.children.splice(index, 1, {
              type: "yaml",
              value: yaml.stringify(newData),
            });
            return EXIT;
          });

          // this block finds inline images and uploads them to cloudinary, then replaces them with an image referencing the Cloudinary path
          visit(tree, "image", (node, index, parent) => {
            const image = node.url;
            const imagePath = transformImagePath(image, "blog");
            cloudinary.v2.uploader
              .upload("./website" + image, {
                public_id: imagePath,
                overwrite: false,
                timeout: 60000000,
              })
              .then((result) => {
                console.log(result);
                if (result.existing === false) {
                  console.log(result);
                }
              })
              .catch((err) => console.error(blog, err));

            const newNode = {
              ...node,
              url: "/" + imagePath,
            };
            parent.children.splice(index, 1, newNode);
          });

          // this block finds images in the old website liquid template "include" format, uploads them to cloudinary and replaces them with an image referencing the Cloudinary path
          visit(tree, "paragraph", (node, index, parent) => {
            if (node.children[0].value?.startsWith("{% include image.html")) {
              const parsed = liquidEngine.parse(node.children[0].value);
              const { args } = parsed[0];
              const image = args[1].replace("path=", "").replaceAll(`"`, "");
              const imagePath = transformImagePath(image, "blog");
              cloudinary.v2.uploader
                .upload("./website" + image, {
                  public_id: imagePath,
                  overwrite: false,
                  timeout: 60000000,
                })
                .then((result) => {
                  if (result.existing === false) {
                    console.log(result);
                  }
                })
                .catch((err) => console.error(err));

              const alt = args
                .slice(2)
                .join(" ")
                .replace("alt=", "")
                .replaceAll(`"`, "");

              const newNode = {
                ...node,
                children: [
                  {
                    type: "image",
                    alt,
                    url: "/" + imagePath,
                    position: node.children[0].position,
                  },
                  ...node.children.slice(1),
                ],
              };
              parent.children.splice(index, 1, newNode);
            }
          });
        };
      })
      .use(remarkStringify, { commonMark: true, gfm: true })
      .use(remarkGfm)
      .process(await read(INPUT_BLOGS_FOLDER + "/" + blog));

    // write the file as a .mdx and remove the date from the start of the file path
    await fs.writeFile(
      OUTPUT_FOLDER +
        "/blogs/" +
        blog.split("-").slice(3).join("-").replace(".md", ".mdx"),
      String(file)
    );

    await unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(remarkStringify)
      .process(file);
  } catch (err) {
    console.log(blog);
    throw err;
  }
  // this block doesn't do anything but catches issues with conversion to .mdx without needing to move the files to the new website and run build
});

const authors = await fs.readdir(INPUT_AUTHORS_FOLDER);
// this block migrates authors from the old website to the new format and uploads images to Cloudinary. Authors do not currently have content so it is a simple frontmatter conversion.
authors.forEach(async (author) => {
  try {
    const file = await unified()
      .use(remarkParse)
      .use(remarkStringify)
      .use(remarkFrontmatter)
      .use(extract, { yaml: yaml.parse })
      .use(function () {
        return function (tree, file) {
          const { data } = file;

          const imagePath = transformImagePath(data.image, "author");
          cloudinary.v2.uploader
            .upload(OLD_WEBSITE_PATH + data.image, {
              public_id: imagePath,
              overwrite: false,
            })
            .then((result) => console.log(result))
            .catch((err) => console.error(author, err));

          const last_name =
            data.last_name === data.first_name ? "" : data.last_name;

          const newData = {
            ...data,
            username: undefined,
            image: imagePath,
            last_name,
          };
          visit(tree, "yaml", (node, index, parent) => {
            parent.children.splice(index, 1, {
              type: "yaml",
              value: yaml.stringify(newData),
            });
            return EXIT;
          });
        };
      })
      .process(await read(OLD_WEBSITE_PATH + "/_authors/" + author));

    await fs.writeFile(
      OUTPUT_FOLDER +
        "/authors/" +
        transformAuthor(author.replace(".md", "")) +
        ".md",
      String(file)
    );
  } catch (err) {
    console.log(author);
    throw err;
  }
});

// write the tag list to a markdown content collection folder
tags.forEach(async (tag) => {
  const data = {
    name: tag.name,
  };
  const file = yaml.stringify(data);
  await fs.writeFile(
    OUTPUT_FOLDER + "/tags/" + tag.key + ".md",
    `---\n` + String(file) + `---`
  );
});
